plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.glasstv.launcher"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.glasstv.launcher"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// After every debug build, copy the APK to <project>/dist/Hearth.apk so it is easy to find
// (and so the README download link always points at the latest build).
val copyApkToDist by tasks.registering(Copy::class) {
    from(layout.buildDirectory.file("outputs/apk/debug/app-debug.apk"))
    into(rootProject.layout.projectDirectory.dir("dist"))
    rename { "Hearth.apk" }
}
tasks.matching { it.name == "assembleDebug" }.configureEach { finalizedBy(copyApkToDist) }

// No third-party dependencies: the launcher only uses the Android framework and WebView.
