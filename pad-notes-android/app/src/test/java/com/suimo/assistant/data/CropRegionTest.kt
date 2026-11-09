package com.suimo.assistant.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CropRegionTest {

    @Test
    fun fullRegionIsDetected() {
        assertTrue(CropRegion.FULL.isFull)
        assertFalse(CropRegion(0.1f, 0.1f, 0.9f, 0.9f).isFull)
    }

    @Test
    fun normalizedClampsAndOrdersEdges() {
        val region = CropRegion(left = 0.9f, top = 1.4f, right = 0.2f, bottom = -0.2f).normalized()
        assertEquals(0.2f, region.left, 0.0001f)
        assertEquals(0.9f, region.right, 0.0001f)
        assertEquals(0f, region.top, 0.0001f)
        assertEquals(1f, region.bottom, 0.0001f)
    }

    @Test
    fun pixelBoundsRoundAndStayInsideImage() {
        val bounds = CropRegion(0.1f, 0.2f, 0.9f, 0.8f).pixelBounds(1000, 500)
        assertEquals(100, bounds.left)
        assertEquals(100, bounds.top)
        assertEquals(900, bounds.right)
        assertEquals(400, bounds.bottom)

        val full = CropRegion.FULL.pixelBounds(1280, 800)
        assertEquals(PixelBounds(0, 0, 1280, 800), full)
    }

    @Test
    fun pixelBoundsKeepAtLeastOnePixel() {
        val bounds = CropRegion(0.5f, 0.5f, 0.5f, 0.5f).pixelBounds(10, 10)
        assertEquals(1, bounds.width)
        assertEquals(1, bounds.height)
        assertTrue(bounds.right <= 10)
        assertTrue(bounds.bottom <= 10)
    }

    @Test
    fun movedByPreservesSizeAndClamps() {
        val region = CropRegion(0.2f, 0.2f, 0.6f, 0.6f)
        val moved = region.movedBy(0.2f, 0.1f)
        assertEquals(0.4f, moved.left, 0.0001f)
        assertEquals(0.8f, moved.right, 0.0001f)
        val edge = region.movedBy(5f, 5f)
        assertEquals(1f, edge.right, 0.0001f)
        assertEquals(1f, edge.bottom, 0.0001f)
        assertEquals(0.4f, edge.right - edge.left, 0.0001f)
    }
}
