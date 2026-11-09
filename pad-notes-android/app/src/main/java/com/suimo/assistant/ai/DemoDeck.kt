package com.suimo.assistant.ai

import java.util.concurrent.TimeUnit

/**
 * Deterministic demo-suggestion rotation for local demo mode.
 *
 * Real captures are rate-limited by the user tapping the bubble, but a demo
 * deck can be requested repeatedly without any network cost. It therefore
 * enforces a minimum interval and never returns the same pattern twice in a
 * row. There is deliberately no global "nth suggestion" counter.
 */
class DemoDeck(
    private val patterns: List<Analysis>,
    private val minIntervalMs: Long = TimeUnit.SECONDS.toMillis(8),
) {
    init {
        require(patterns.isNotEmpty()) { "A demo deck needs at least one pattern" }
        require(minIntervalMs >= 0) { "minIntervalMs must not be negative" }
    }

    private var lastAt: Long? = null
    private var index = -1

    /** Returns the next pattern, or null when the 8s demo interval is not over. */
    fun next(nowMs: Long): Analysis? {
        val previous = lastAt
        if (previous != null && nowMs - previous < minIntervalMs) return null
        lastAt = nowMs
        val nextIndex = (index + 1) % patterns.size
        if (patterns.size > 1 && nextIndex == index) {
            index = (nextIndex + 1) % patterns.size
        } else {
            index = nextIndex
        }
        return patterns[index]
    }

    fun reset() {
        lastAt = null
        index = -1
    }
}
