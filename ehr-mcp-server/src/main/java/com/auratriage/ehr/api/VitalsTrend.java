package com.auratriage.ehr.api;

/** Trend of one vital over the latest sliding window of {@code windowSize} readings. */
public record VitalsTrend(VitalMetric metric, Direction direction, int windowSize) {}
