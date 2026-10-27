package com.auratriage.ehr.transform;

import com.auratriage.ehr.api.Direction;
import com.auratriage.ehr.api.VitalMetric;
import com.auratriage.ehr.api.VitalsTrend;
import com.auratriage.ehr.domain.VitalReading;
import java.util.Comparator;
import java.util.List;
import java.util.function.ToIntFunction;
import java.util.stream.Gatherers;

/**
 * Classifies how a vital is moving using a sliding window over the readings (Stream Gatherers,
 * final since Java 24). The trend reported is that of the most recent window.
 */
public final class VitalsTrendAnalyzer {

    /** Readings per window. */
    public static final int WINDOW = 3;

    /** Smallest change across a window that counts as a trend, in mmHg or beats per minute. */
    static final int MIN_CHANGE = 10;

    public List<VitalsTrend> analyze(List<VitalReading> readings) {
        List<VitalReading> chronological = readings.stream()
                .sorted(Comparator.comparing(VitalReading::date))
                .toList();
        return List.of(
                trend(VitalMetric.SYSTOLIC_BP, chronological, VitalReading::systolicBp),
                trend(VitalMetric.HEART_RATE, chronological, VitalReading::heartRate));
    }

    private static VitalsTrend trend(
            VitalMetric metric, List<VitalReading> chronological, ToIntFunction<VitalReading> value) {
        Direction latest = chronological.stream()
                .map(value::applyAsInt)
                .gather(Gatherers.windowSliding(WINDOW))
                .map(VitalsTrendAnalyzer::classify)
                .reduce((earlier, later) -> later)
                .orElse(Direction.STABLE);
        return new VitalsTrend(metric, latest, WINDOW);
    }

    /** A window only counts as a trend if it is strictly monotonic and moves at least {@link #MIN_CHANGE}. */
    static Direction classify(List<Integer> window) {
        if (window.size() < WINDOW) {
            return Direction.STABLE;
        }
        boolean rising = true;
        boolean falling = true;
        for (int i = 1; i < window.size(); i++) {
            rising &= window.get(i) > window.get(i - 1);
            falling &= window.get(i) < window.get(i - 1);
        }
        int change = window.getLast() - window.getFirst();
        if (rising && change >= MIN_CHANGE) {
            return Direction.RISING;
        }
        if (falling && -change >= MIN_CHANGE) {
            return Direction.FALLING;
        }
        return Direction.STABLE;
    }
}
