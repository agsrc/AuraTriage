package com.auratriage.ehr.transform;

import com.auratriage.ehr.api.EpisodeOfCare;
import com.auratriage.ehr.domain.Encounter;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.function.BiConsumer;
import java.util.stream.Gatherer;

/** Custom stateful Gatherers over encounters. */
public final class EpisodeGatherers {

    private EpisodeGatherers() {}

    /**
     * Groups chronologically ordered encounters into episodes of care: a new episode starts when more
     * than {@code maxGapDays} separate an encounter from the previous one. The episode label is the
     * type of its first encounter.
     *
     * <p>The input must already be sorted by date, oldest first.
     */
    public static Gatherer<Encounter, ?, EpisodeOfCare> episodesOfCare(int maxGapDays) {
        Gatherer.Integrator<OpenEpisode, Encounter, EpisodeOfCare> integrator =
                (episode, encounter, downstream) -> {
                    if (episode.isOpen() && episode.daysUntil(encounter.date()) > maxGapDays) {
                        if (!downstream.push(episode.close())) {
                            return false;
                        }
                    }
                    episode.add(encounter);
                    return true;
                };
        BiConsumer<OpenEpisode, Gatherer.Downstream<? super EpisodeOfCare>> finisher =
                (episode, downstream) -> {
                    if (episode.isOpen()) {
                        downstream.push(episode.close());
                    }
                };
        return Gatherer.ofSequential(OpenEpisode::new, integrator, finisher);
    }

    /** Mutable per-stream state: the episode currently being accumulated. */
    private static final class OpenEpisode {
        private LocalDate start;
        private LocalDate end;
        private String label;
        private int count;

        boolean isOpen() {
            return count > 0;
        }

        long daysUntil(LocalDate date) {
            return ChronoUnit.DAYS.between(end, date);
        }

        void add(Encounter encounter) {
            if (count == 0) {
                start = encounter.date();
                label = encounter.type();
            }
            end = encounter.date();
            count++;
        }

        EpisodeOfCare close() {
            EpisodeOfCare episode = new EpisodeOfCare(label, start.toString(), end.toString(), count);
            count = 0;
            return episode;
        }
    }
}
