package com.auratriage.ehr.transform;

import com.auratriage.ehr.domain.Provider;
import com.auratriage.ehr.domain.Slot;
import java.util.Comparator;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Gatherers;

/** Merges per-provider slot lookups into one soonest-first list. */
public final class AvailabilityAggregator {

    /** Upper bound on simultaneous provider lookups. */
    static final int MAX_CONCURRENT_LOOKUPS = 4;

    private AvailabilityAggregator() {}

    /**
     * Looks up every provider concurrently with {@code Gatherers.mapConcurrent} (virtual threads), which
     * models fanning out to a slow legacy scheduling system, then merges and keeps the earliest
     * {@code limit} slots. Output order is deterministic: start time, then slot ID.
     */
    public static List<Slot> earliestOpenSlots(
            List<Provider> providers, Function<Provider, List<Slot>> lookup, int limit) {
        return providers.stream()
                .gather(Gatherers.mapConcurrent(MAX_CONCURRENT_LOOKUPS, lookup))
                .flatMap(List::stream)
                .sorted(Comparator.comparing(Slot::start).thenComparing(Slot::slotId))
                .limit(limit)
                .toList();
    }
}
