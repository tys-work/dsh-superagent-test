package com.suimo.assistant.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import androidx.core.content.ContextCompat
import com.suimo.assistant.R
import com.suimo.assistant.data.CropRegion
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.min

/**
 * Full-screen frozen-frame crop picker. Draws the captured screen dimmed, with
 * a bright selection rectangle the user can drag or resize before the next
 * analysis. Coordinates are normalized so they survive rotation and different
 * capture sizes.
 */
class CropView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {

    private enum class Mode { NONE, MOVE, NEW, TOP_LEFT, TOP_RIGHT, BOTTOM_RIGHT, BOTTOM_LEFT }

    private var bitmap: Bitmap? = null
    private var region = CropRegion.FULL
    private var onRegionChanged: ((CropRegion) -> Unit)? = null

    private val imageRect = RectF()
    private val selectionRect = RectF()
    private val accent = ContextCompat.getColor(context, R.color.accent)
    private val handleFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = accent
    }
    private val handleStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = Color.WHITE
        strokeWidth = dp(2f)
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = accent
        strokeWidth = dp(2f)
    }
    private val dimPaint = Paint().apply { color = 0xA6141210.toInt() }
    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = 0x66FFF8F0
        strokeWidth = dp(1f)
    }
    private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val handleRadius = dp(10f)
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

    private var mode = Mode.NONE
    private var downX = 0f
    private var downY = 0f
    private var anchorX = 0f
    private var anchorY = 0f
    private var startRegion = CropRegion.FULL
    private var moved = false

    fun setImage(bitmap: Bitmap, initialRegion: CropRegion) {
        this.bitmap = bitmap
        region = initialRegion.normalized()
        updateImageRect()
        invalidate()
    }

    fun region(): CropRegion = region

    fun setOnRegionChanged(listener: (CropRegion) -> Unit) {
        onRegionChanged = listener
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        updateImageRect()
    }

    private fun updateImageRect() {
        val source = bitmap ?: return
        if (width == 0 || height == 0) return
        val scale = min(width.toFloat() / source.width, height.toFloat() / source.height)
        val drawWidth = source.width * scale
        val drawHeight = source.height * scale
        val left = (width - drawWidth) / 2f
        val top = (height - drawHeight) / 2f
        imageRect.set(left, top, left + drawWidth, top + drawHeight)
    }

    private fun selectionRect(): RectF {
        selectionRect.set(
            imageRect.left + region.left * imageRect.width(),
            imageRect.top + region.top * imageRect.height(),
            imageRect.left + region.right * imageRect.width(),
            imageRect.top + region.bottom * imageRect.height(),
        )
        return selectionRect
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val source = bitmap ?: return
        canvas.drawColor(Color.BLACK)
        canvas.drawBitmap(source, null, imageRect, bitmapPaint)

        val selection = selectionRect()
        val hole = Path().apply {
            fillType = Path.FillType.EVEN_ODD
            addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
            addRect(selection, Path.Direction.CW)
        }
        canvas.drawPath(hole, dimPaint)
        canvas.drawRect(selection, borderPaint)

        // Rule-of-thirds guides inside the selection.
        for (step in 1..2) {
            val x = selection.left + selection.width() * step / 3f
            val y = selection.top + selection.height() * step / 3f
            canvas.drawLine(x, selection.top, x, selection.bottom, gridPaint)
            canvas.drawLine(selection.left, y, selection.right, y, gridPaint)
        }

        drawHandle(canvas, selection.left, selection.top)
        drawHandle(canvas, selection.right, selection.top)
        drawHandle(canvas, selection.right, selection.bottom)
        drawHandle(canvas, selection.left, selection.bottom)
    }

    private fun drawHandle(canvas: Canvas, x: Float, y: Float) {
        canvas.drawCircle(x, y, handleRadius, handleFill)
        canvas.drawCircle(x, y, handleRadius, handleStroke)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (bitmap == null || imageRect.isEmpty) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x
                downY = event.y
                moved = false
                startRegion = region
                val selection = selectionRect()
                val targets = listOf(
                    Mode.TOP_LEFT to Pair(selection.left, selection.top),
                    Mode.TOP_RIGHT to Pair(selection.right, selection.top),
                    Mode.BOTTOM_RIGHT to Pair(selection.right, selection.bottom),
                    Mode.BOTTOM_LEFT to Pair(selection.left, selection.bottom),
                )
                val nearest = targets.minByOrNull { (_, point) ->
                    hypot(event.x - point.first, event.y - point.second)
                }
                val distance = nearest?.let { (_, point) ->
                    hypot(event.x - point.first, event.y - point.second)
                } ?: Float.MAX_VALUE
                mode = when {
                    distance <= dp(32f) -> nearest!!.first
                    selection.contains(event.x, event.y) -> Mode.MOVE
                    else -> {
                        anchorX = normalizeX(event.x)
                        anchorY = normalizeY(event.y)
                        region = CropRegion(anchorX, anchorY, anchorX, anchorY).normalized()
                        notifyChanged()
                        Mode.NEW
                    }
                }
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                if (mode == Mode.NONE) return false
                if (abs(event.x - downX) > touchSlop || abs(event.y - downY) > touchSlop) {
                    moved = true
                }
                val px = normalizeX(event.x)
                val py = normalizeY(event.y)
                when (mode) {
                    Mode.MOVE -> {
                        val dx = (event.x - downX) / imageRect.width()
                        val dy = (event.y - downY) / imageRect.height()
                        region = startRegion.movedBy(dx, dy)
                    }
                    Mode.NEW -> region = CropRegion(anchorX, anchorY, px, py).normalized()
                    Mode.TOP_LEFT -> region = region.copy(
                        left = px.coerceIn(0f, region.right - CropRegion.MIN_SIZE),
                        top = py.coerceIn(0f, region.bottom - CropRegion.MIN_SIZE),
                    )
                    Mode.TOP_RIGHT -> region = region.copy(
                        right = px.coerceIn(region.left + CropRegion.MIN_SIZE, 1f),
                        top = py.coerceIn(0f, region.bottom - CropRegion.MIN_SIZE),
                    )
                    Mode.BOTTOM_RIGHT -> region = region.copy(
                        right = px.coerceIn(region.left + CropRegion.MIN_SIZE, 1f),
                        bottom = py.coerceIn(region.top + CropRegion.MIN_SIZE, 1f),
                    )
                    Mode.BOTTOM_LEFT -> region = region.copy(
                        left = px.coerceIn(0f, region.right - CropRegion.MIN_SIZE),
                        bottom = py.coerceIn(region.top + CropRegion.MIN_SIZE, 1f),
                    )
                    Mode.NONE -> Unit
                }
                notifyChanged()
                return true
            }

            MotionEvent.ACTION_UP -> {
                if (!moved) performClick()
                mode = Mode.NONE
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                mode = Mode.NONE
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    private fun normalizeX(x: Float): Float {
        if (imageRect.width() <= 0f) return 0f
        return ((x - imageRect.left) / imageRect.width()).coerceIn(0f, 1f)
    }

    private fun normalizeY(y: Float): Float {
        if (imageRect.height() <= 0f) return 0f
        return ((y - imageRect.top) / imageRect.height()).coerceIn(0f, 1f)
    }

    private fun notifyChanged() {
        region = region.normalized()
        onRegionChanged?.invoke(region)
        invalidate()
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
}
