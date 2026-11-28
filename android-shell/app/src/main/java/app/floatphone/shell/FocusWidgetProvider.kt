package app.floatphone.shell

import android.appwidget.AppWidgetProvider
import android.content.Context

/** 专注小组件桩：已停用，防止编译找不到资源 */
class FocusWidgetProvider : AppWidgetProvider() {
    companion object {
        fun update(context: Context, json: String): Boolean = true
        fun remove(context: Context): Boolean = true
        fun requestPin(context: Context): Boolean = false
        fun pushAll(context: Context) {}
    }
}
