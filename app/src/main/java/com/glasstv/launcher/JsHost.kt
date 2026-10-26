package com.glasstv.launcher

/** An activity that hosts the HTML UI and can run script in it. */
interface JsHost {
    fun runJs(js: String)
}
