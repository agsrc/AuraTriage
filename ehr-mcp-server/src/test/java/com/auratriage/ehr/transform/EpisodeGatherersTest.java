package com.auratriage.ehr.transform;

import static org.assertj.core.api.Assertions.assertThat;

import com.auratriage.ehr.api.EpisodeOfCare;
import com.auratriage.ehr.domain.Encounter;
import java.time.LocalDate;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class EpisodeGatherersTest {

    @Test
    void emptyInputProducesNoEpisodes() {
        assertThat(Stream.<Encounter>empty().gather(EpisodeGatherers.episodesOfCare(30)).toList()).isEmpty();
    }

    @Test
    void closeEncountersShareAnEpisodeLabelledByTheFirstOne() {
        List<EpisodeOfCare> episodes = episodes(30, encounter("2026-01-01", "primary_care_visit"), encounter("2026-01-15", "lab_review"));

        assertThat(episodes).containsExactly(new EpisodeOfCare("primary_care_visit", "2026-01-01", "2026-01-15", 2));
    }

    @Test
    void aGapOfExactlyTheLimitStaysInTheSameEpisode() {
        List<EpisodeOfCare> episodes = episodes(30, encounter("2026-01-01", "a"), encounter("2026-01-31", "b"));

        assertThat(episodes).hasSize(1);
    }

    @Test
    void aGapBeyondTheLimitStartsANewEpisode() {
        List<EpisodeOfCare> episodes = episodes(30, encounter("2026-01-01", "a"), encounter("2026-02-01", "b"));

        assertThat(episodes).containsExactly(
                new EpisodeOfCare("a", "2026-01-01", "2026-01-01", 1),
                new EpisodeOfCare("b", "2026-02-01", "2026-02-01", 1));
    }

    @Test
    void groupsAMixedHistoryIntoEpisodes() {
        List<EpisodeOfCare> episodes = episodes(
                30,
                encounter("2025-11-04", "primary_care_visit"),
                encounter("2025-11-18", "lab_review"),
                encounter("2026-02-10", "primary_care_visit"),
                encounter("2026-06-02", "cardiology_consult"),
                encounter("2026-06-20", "primary_care_visit"));

        assertThat(episodes).extracting(EpisodeOfCare::encounterCount).containsExactly(2, 1, 2);
        assertThat(episodes).extracting(EpisodeOfCare::label)
                .containsExactly("primary_care_visit", "primary_care_visit", "cardiology_consult");
    }

    @Test
    void stopsCleanlyWhenTheDownstreamStopsEarly() {
        List<EpisodeOfCare> first = Stream.of(encounter("2026-01-01", "a"), encounter("2026-03-01", "b"), encounter("2026-05-01", "c"))
                .gather(EpisodeGatherers.episodesOfCare(30))
                .limit(1)
                .toList();

        assertThat(first).containsExactly(new EpisodeOfCare("a", "2026-01-01", "2026-01-01", 1));
    }

    private static List<EpisodeOfCare> episodes(int maxGapDays, Encounter... encounters) {
        return Stream.of(encounters).gather(EpisodeGatherers.episodesOfCare(maxGapDays)).toList();
    }

    private static Encounter encounter(String date, String type) {
        return new Encounter(LocalDate.parse(date), type, "summary");
    }
}
