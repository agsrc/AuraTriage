package com.auratriage.ehr.transform;

import static org.assertj.core.api.Assertions.assertThat;

import com.auratriage.ehr.domain.Provider;
import com.auratriage.ehr.domain.Slot;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class AvailabilityAggregatorTest {

    @Test
    void mergesProvidersSoonestFirstThenBySlotIdAndKeepsOnlyTheLimit() {
        Map<String, List<Slot>> slotsByProvider = Map.of(
                "D-1", List.of(slot("S-0003", "D-1", "2026-11-02T09:00:00Z"), slot("S-0001", "D-1", "2026-11-03T09:00:00Z")),
                "D-2", List.of(slot("S-0002", "D-2", "2026-11-02T09:00:00Z")));

        List<Slot> result = AvailabilityAggregator.earliestOpenSlots(
                List.of(provider("D-1"), provider("D-2")), p -> slotsByProvider.get(p.id()), 2);

        assertThat(result).extracting(Slot::slotId).containsExactly("S-0002", "S-0003");
    }

    @Test
    void noProvidersMeansNoSlots() {
        assertThat(AvailabilityAggregator.earliestOpenSlots(List.of(), p -> List.of(), 10)).isEmpty();
    }

    @Test
    void lookupsOverlapButNeverExceedTheCap() {
        AtomicInteger inFlight = new AtomicInteger();
        AtomicInteger peak = new AtomicInteger();
        List<Provider> providers = IntStream.range(0, 12).mapToObj(i -> provider("D-" + i)).toList();

        AvailabilityAggregator.earliestOpenSlots(
                providers,
                p -> {
                    peak.accumulateAndGet(inFlight.incrementAndGet(), Math::max);
                    try {
                        Thread.sleep(50);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    } finally {
                        inFlight.decrementAndGet();
                    }
                    return List.of();
                },
                10);

        assertThat(peak.get()).isGreaterThan(1).isLessThanOrEqualTo(AvailabilityAggregator.MAX_CONCURRENT_LOOKUPS);
    }

    private static Provider provider(String id) {
        return new Provider(id, "Dr. " + id, "cardiology");
    }

    private static Slot slot(String slotId, String providerId, String start) {
        return new Slot(slotId, providerId, Instant.parse(start), 30);
    }
}
