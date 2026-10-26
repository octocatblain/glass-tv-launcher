package com.glasstv.launcher

import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/**
 * Fetches the hourly weather shown in the home screen weather panel.
 *
 * Uses Open-Meteo, which needs no API key, and finds the TV's rough position from a free
 * IP-location service. Nothing is sent about the user; only the resolved latitude/longitude
 * goes to Open-Meteo. The result is cached for a few minutes so reopening the launcher or
 * refreshing the UI does not hit the network each time.
 *
 * config.js can override the position with
 * `weather: { lat: -1.2921, lon: 36.8219, place: "Nairobi", units: "c" }`.
 */
class Weather(private val activity: MainActivity) {

    companion object {
        private const val CACHE_MS = 10 * 60 * 1000L
        private const val LOCATION_MS = 7L * 24 * 60 * 60 * 1000L
    }

    private data class Location(val lat: Double, val lon: Double, val place: String)

    private val prefs = activity.getSharedPreferences("weather", Context.MODE_PRIVATE)

    @Volatile
    private var running = false

    /** Called from the page. Runs off the main thread and answers with window.onWeather(json). */
    fun request(latArg: String, lonArg: String, placeArg: String, unitsArg: String) {
        synchronized(this) {
            if (running) return
            running = true
        }
        Thread {
            try {
                val payload = load(latArg, lonArg, placeArg, unitsArg)
                activity.runJs("window.onWeather(${JSONObject.quote(payload.toString())})")
            } catch (t: Throwable) {
                val message = t.message?.takeIf { it.isNotBlank() } ?: "Weather unavailable"
                activity.runJs("window.onWeatherError(${JSONObject.quote(message)})")
            } finally {
                synchronized(this) { running = false }
            }
        }.start()
    }

    private fun load(latArg: String, lonArg: String, placeArg: String, unitsArg: String): JSONObject {
        val units = if (unitsArg.trim().equals("f", ignoreCase = true)) "f" else "c"
        val key = listOf(latArg, lonArg, placeArg, units).joinToString("|")
        val now = System.currentTimeMillis()

        val cached = prefs.getString("payload", null)
        val cachedAt = prefs.getLong("payload_at", 0L)
        val cachedKey = prefs.getString("payload_key", "")
        if (cached != null && cachedKey == key && now - cachedAt < CACHE_MS) {
            return JSONObject(cached)
        }

        return try {
            val loc = resolveLocation(latArg, lonArg, placeArg)
            val data = JSONObject(httpGet(forecastUrl(loc, units)))
            val out = JSONObject()
            out.put("place", loc.place)
            out.put("units", units)
            out.put("fetchedAt", now)
            out.put("stale", false)
            out.put("current", data.optJSONObject("current") ?: JSONObject.NULL)
            out.put("hourly", data.optJSONObject("hourly") ?: JSONObject.NULL)
            prefs.edit()
                .putString("payload", out.toString())
                .putLong("payload_at", now)
                .putString("payload_key", key)
                .apply()
            out
        } catch (t: Throwable) {
            // A stale forecast is better than an empty card when the network is flaky.
            if (cached != null && cachedKey == key) {
                JSONObject(cached).put("stale", true)
            } else {
                throw t
            }
        }
    }

    private fun resolveLocation(latArg: String, lonArg: String, placeArg: String): Location {
        val lat = latArg.trim().toDoubleOrNull()
        val lon = lonArg.trim().toDoubleOrNull()
        if (isValid(lat, lon)) {
            return Location(lat!!, lon!!, placeArg.trim().ifBlank { "Your area" })
        }

        val saved = Location(
            prefs.getString("geo_lat", null)?.toDoubleOrNull() ?: Double.NaN,
            prefs.getString("geo_lon", null)?.toDoubleOrNull() ?: Double.NaN,
            prefs.getString("geo_place", "") ?: ""
        )
        val savedAt = prefs.getLong("geo_at", 0L)
        if (isValid(saved.lat, saved.lon) && System.currentTimeMillis() - savedAt < LOCATION_MS) {
            return saved
        }

        return try {
            lookupByIp().also {
                prefs.edit()
                    .putString("geo_lat", it.lat.toString())
                    .putString("geo_lon", it.lon.toString())
                    .putString("geo_place", it.place)
                    .putLong("geo_at", System.currentTimeMillis())
                    .apply()
            }
        } catch (t: Throwable) {
            if (isValid(saved.lat, saved.lon)) saved else throw t
        }
    }

    private fun isValid(lat: Double?, lon: Double?): Boolean =
        lat != null && lon != null && !lat.isNaN() && !lon.isNaN() &&
            lat in -90.0..90.0 && lon in -180.0..180.0

    /** Free IP lookups, tried in order. They only need the public IP, not a location permission. */
    private fun lookupByIp(): Location {
        // ipwho.is
        runCatching {
            val o = JSONObject(httpGet("https://ipwho.is/"))
            if (o.optBoolean("success", true)) {
                return locationOf(o.optDouble("latitude", Double.NaN), o.optDouble("longitude", Double.NaN),
                    o.optString("city"), o.optString("region"), o.optString("country"))
            }
        }

        // ipapi.co
        runCatching {
            val o = JSONObject(httpGet("https://ipapi.co/json/"))
            if (!o.optBoolean("error", false)) {
                return locationOf(o.optDouble("latitude", Double.NaN), o.optDouble("longitude", Double.NaN),
                    o.optString("city"), o.optString("region"), o.optString("country_name"))
            }
        }

        // freeipapi.com
        runCatching {
            val o = JSONObject(httpGet("https://freeipapi.com/api/json"))
            return locationOf(o.optDouble("latitude", Double.NaN), o.optDouble("longitude", Double.NaN),
                o.optString("cityName"), o.optString("regionName"), o.optString("countryName"))
        }

        throw IOException("Couldn't find your location")
    }

    private fun locationOf(
        lat: Double,
        lon: Double,
        city: String,
        region: String,
        country: String
    ): Location {
        if (!isValid(lat, lon)) throw IOException("Location service returned no position")
        val place = listOf(city, region, country)
            .map { it.trim() }
            .firstOrNull { it.isNotEmpty() && !it.equals("null", ignoreCase = true) }
            ?: "Nearby"
        return Location(lat, lon, place)
    }

    private fun forecastUrl(loc: Location, units: String): String {
        val unitParam = if (units == "f") "&temperature_unit=fahrenheit" else ""
        return "https://api.open-meteo.com/v1/forecast" +
            "?latitude=${String.format(Locale.US, "%.4f", loc.lat)}" +
            "&longitude=${String.format(Locale.US, "%.4f", loc.lon)}" +
            "&current=temperature_2m,weather_code" +
            "&hourly=temperature_2m,weather_code,precipitation_probability" +
            // Past day covers the previous hour just after midnight; two forecast days cover
            // the next hour just before midnight.
            "&past_days=1&forecast_days=2" +
            // auto makes the API return times in the location's own zone; the page locates the
            // current hour from current.time, so the device time zone does not matter.
            "&timezone=auto" +
            unitParam
    }

    private fun httpGet(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 8_000
            conn.readTimeout = 12_000
            conn.requestMethod = "GET"
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "Hearth/${version()} (Android TV)")
            val code = conn.responseCode
            if (code !in 200..299) throw IOException("Weather service returned $code")
            return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun version(): String = try {
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "1.5"
    } catch (_: Exception) {
        "1.5"
    }
}
