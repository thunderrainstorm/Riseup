package com.riseup

import android.content.Context
import android.media.MediaPlayer
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SoundPlayer(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val context: Context = reactContext.applicationContext

    override fun getName(): String = "SoundPlayer"

    @ReactMethod
    fun playSound(soundName: String) {
        val resId = context.resources.getIdentifier(
            soundName,
            "raw",
            context.packageName
        )
        
        MediaPlayer.create(context, resId).apply {
            start()
            setOnCompletionListener { release() }
        }
    }
}