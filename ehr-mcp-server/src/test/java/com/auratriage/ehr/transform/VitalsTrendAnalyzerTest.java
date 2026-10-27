package com.auratriage.ehr.transform;

import static org.assertj.core.api.Assertions.assertThat;

import com.auratriage.ehr.api.Direction;
import com.auratriage.ehr.api.VitalMetric;
import com.auratriage.ehr.api.VitalsTrend;
import com.auratriage.ehr.domain.VitalReading;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class VitalsTrendAnalyzerTest {

    private final VitalsTrendAnalyzer analyzer = new VitalsTrendAnalyzer();

    @Test
    void reportsRisingWhenLatestWindowClimbsByTenOrMore() {
        List<VitalsTrend> trends = analyzer.analyze(List.of(
                reading("2026-02-10", 132, 74), reading("2026-06-02", 138, 72), reading("2026-06-20", 146, 73)));

        assertThat(directionOf(trends, VitalMetric.SYSTOLIC_BP)).isEqualTo(Direction.RISING);
        assertThat(directionOf(trends, VitalMetric.HEART_RATE)).isEqualTo(Direction.STABLE);
    }

    @Test
    void reportsFallingWhenLatestWindowDropsByTenOrMore() {
        List<VitalsTrend> trends = analyzer.analyze(List.of(
                reading("2026-03-03", 136, 96), reading("2026-07-14", 134, 86), reading("2026-09-01", 132, 76)));

        assertThat(directionOf(trends, VitalMetric.HEART_RATE)).isEqualTo(Direction.FALLING);
        assertThat(directionOf(trends, VitalMetric.SYSTOLIC_BP)).isEqualTo(Direction.STABLE);
    }

    @Test
    void smallOrNonMonotonicMovesAreStable() {
        List<VitalsTrend> trends = analyzer.analyze(List.of(
                reading("2026-01-01", 120, 70), reading("2026-02-01", 140, 72), reading("2026-03-01", 125, 74)));

        assertThat(directionOf(trends, VitalMetric.SYSTOLIC_BP)).isEqualTo(Direction.STABLE);
        assertThat(directionOf(trends, VitalMetric.HEART_RATE)).isEqualTo(Direction.STABLE);
    }

    @Test
    void latestWindowWinsOverEarlierOnes() {
        List<VitalsTrend> trends = analyzer.analyze(List.of(
                reading("2026-01-01", 100, 70),
                reading("2026-02-01", 112, 70),
                reading("2026-03-01", 125, 70),
                reading("2026-04-01", 124, 70),
                reading("2026-05-01", 123, 70)));

        assertThat(directionOf(trends, VitalMetric.SYSTOLIC_BP)).isEqualTo(Direction.STABLE);
    }

    @Test
    void sortsByDateBeforeLookingForTrends() {
        List<VitalsTrend> trends = analyzer.analyze(List.of(
                reading("2026-06-20", 146, 73), reading("2026-02-10", 132, 74), reading("2026-06-02", 138, 72)));

        assertThat(directionOf(trends, VitalMetric.SYSTOLIC_BP)).isEqualTo(Direction.RISING);
    }

    @Test
    void tooFewReadingsAreStable() {
        assertThat(analyzer.analyze(List.of()))
                .extracting(VitalsTrend::direction)
                .containsOnly(Direction.STABLE);
        assertThat(analyzer.analyze(List.of(reading("2026-01-01", 100, 60), reading("2026-02-01", 150, 100))))
                .extracting(VitalsTrend::direction)
                .containsOnly(Direction.STABLE);
    }

    @Test
    void reportsTheWindowSize() {
        assertThat(analyzer.analyze(List.of())).extracting(VitalsTrend::windowSize).containsOnly(3);
    }

    private static VitalReading reading(String date, int systolicBp, int heartRate) {
        return new VitalReading(LocalDate.parse(date), systolicBp, heartRate);
    }

    private static Direction directionOf(List<VitalsTrend> trends, VitalMetric metric) {
        return trends.stream()
                .filter(trend -> trend.metric() == metric)
                .findFirst()
                .orElseThrow()
                .direction();
    }
}
