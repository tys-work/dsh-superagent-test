package com.suimo.assistant.util

import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.media.Image
import com.suimo.assistant.data.CropRegion
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

object ImageTools {

    private const val AI_MAX_DIMENSION = 1600
    private const val AI_JPEG_QUALITY = 84

    /** Converts an RGBA_8888 MediaProjection frame, respecting row padding. */
    fun imageToBitmap(image: Image): Bitmap {
        require(image.format == PixelFormat.RGBA_8888) {
            "Unexpected image format ${image.format}"
        }
        val plane = image.planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * image.width
        val paddedWidth = image.width + rowPadding / pixelStride
        val padded = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
        padded.copyPixelsFromBuffer(buffer)
        if (rowPadding == 0) return padded
        val cropped = Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
        padded.recycle()
        return cropped
    }

    /** Crop according to the user's region, scale down, and encode as JPEG. */
    fun encodeForAi(
        source: Bitmap,
        crop: CropRegion,
        maxDimension: Int = AI_MAX_DIMENSION,
        quality: Int = AI_JPEG_QUALITY,
    ): ByteArray {
        val bounds = crop.pixelBounds(source.width, source.height)
        val cropped = Bitmap.createBitmap(
            source,
            bounds.left,
            bounds.top,
            bounds.width,
            bounds.height,
        )
        val scaled = scaleDown(cropped, maxDimension)
        val output = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, output)
        if (scaled !== cropped && !cropped.isRecycled) cropped.recycle()
        if (scaled !== source && scaled !== cropped && !scaled.isRecycled) scaled.recycle()
        return output.toByteArray()
    }

    fun scaleDown(source: Bitmap, maxDimension: Int): Bitmap {
        val longest = maxOf(source.width, source.height)
        if (longest <= maxDimension) return source
        val scale = maxDimension.toFloat() / longest
        val width = (source.width * scale).roundToInt().coerceAtLeast(1)
        val height = (source.height * scale).roundToInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(source, width, height, true)
    }

    /** Mirrored size for the virtual display: large screens are downscaled. */
    fun captureSize(
        widthPx: Int,
        heightPx: Int,
        maxDimension: Int = AI_MAX_DIMENSION,
    ): Pair<Int, Int> {
        val longest = maxOf(widthPx, heightPx)
        if (longest <= maxDimension) return widthPx to heightPx
        val scale = maxDimension.toFloat() / longest
        return (widthPx * scale).roundToInt().coerceAtLeast(1) to
            (heightPx * scale).roundToInt().coerceAtLeast(1)
    }
}
