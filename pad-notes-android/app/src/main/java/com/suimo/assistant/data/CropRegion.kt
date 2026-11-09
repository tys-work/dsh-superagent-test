package com.suimo.assistant.data

import kotlin.math.roundToInt

/**
 * A crop rectangle in normalized image coordinates (0..1). Kept free of
 * Android classes so the mapping can be unit-tested on the JVM.
 */
data class CropRegion(
    val left: Float = 0f,
    val top: Float = 0f,
    val right: Float = 1f,
    val bottom: Float = 1f,
) {
    fun normalized(): CropRegion {
        val l = left.coerceIn(0f, 1f)
        val t = top.coerceIn(0f, 1f)
        val r = right.coerceIn(0f, 1f)
        val b = bottom.coerceIn(0f, 1f)
        val clampedLeft = minOf(l, r)
        val clampedRight = maxOf(l, r)
        val clampedTop = minOf(t, b)
        val clampedBottom = maxOf(t, b)
        return CropRegion(
            left = clampedLeft.coerceAtMost(1f - MIN_SIZE),
            top = clampedTop.coerceAtMost(1f - MIN_SIZE),
            right = clampedRight.coerceAtLeast(MIN_SIZE),
            bottom = clampedBottom.coerceAtLeast(MIN_SIZE),
        )
    }

    /** Pixel bounds for an image; always at least one pixel wide and tall. */
    fun pixelBounds(width: Int, height: Int): PixelBounds {
        require(width > 0 && height > 0) { "width and height must be positive" }
        val clamped = normalized()
        val l = (clamped.left * width).roundToInt().coerceIn(0, width - 1)
        val t = (clamped.top * height).roundToInt().coerceIn(0, height - 1)
        val r = (clamped.right * width).roundToInt().coerceIn(l + 1, width)
        val b = (clamped.bottom * height).roundToInt().coerceIn(t + 1, height)
        return PixelBounds(l, t, r, b)
    }

    val isFull: Boolean
        get() = left <= 0.001f && top <= 0.001f && right >= 0.999f && bottom >= 0.999f

    fun inset(delta: Float): CropRegion = CropRegion(
        left = (left + delta).coerceIn(0f, 1f),
        top = (top + delta).coerceIn(0f, 1f),
        right = (right - delta).coerceIn(0f, 1f),
        bottom = (bottom - delta).coerceIn(0f, 1f),
    ).normalized()

    fun movedBy(dx: Float, dy: Float): CropRegion {
        val width = right - left
        val height = bottom - top
        val newLeft = (left + dx).coerceIn(0f, 1f - width)
        val newTop = (top + dy).coerceIn(0f, 1f - height)
        return CropRegion(newLeft, newTop, newLeft + width, newTop + height)
    }

    companion object {
        const val MIN_SIZE = 0.08f
        val FULL = CropRegion()
    }
}

data class PixelBounds(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top
}
