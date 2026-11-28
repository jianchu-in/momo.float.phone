package app.floatphone.shell

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 系统添加桌面小组件回调接收器。
 * 当用户通过 requestPinAppWidget 引导成功将小组件固定到桌面时，
 * 系统会触发本接收器，将新建的 widgetId 与所选的 profileId 关联绑死。
 */
class PhoneWidgetPinReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val targetIntent = intent ?: return
        val widgetId = targetIntent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        )
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return

        val profileIdFromExtra = targetIntent.getStringExtra(PhoneWidgetProvider.EXTRA_PROFILE_ID).orEmpty()
        val profileIdFromData = targetIntent.data?.lastPathSegment.orEmpty()
        val profileId = profileIdFromExtra.ifBlank { profileIdFromData }.ifBlank { "default" }

        PhoneWidgetProvider.assignProfile(context, widgetId, profileId)
        val (w, h, scale) = PhoneWidgetProvider.loadSize(context, profileId)
        PhoneWidgetRenderer.renderCached(context, profileId, w, h, scale)
        PhoneWidgetProvider.updateOne(context, AppWidgetManager.getInstance(context), widgetId)
    }
}
