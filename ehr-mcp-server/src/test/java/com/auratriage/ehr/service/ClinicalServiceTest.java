package com.auratriage.ehr.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.auratriage.ehr.api.AvailabilityResult;
import com.auratriage.ehr.api.BookingResult;
import com.auratriage.ehr.api.BookingStatus;
import com.auratriage.ehr.api.Direction;
import com.auratriage.ehr.api.EncounterSummary;
import com.auratriage.ehr.api.EpisodeOfCare;
import com.auratriage.ehr.api.PatientHistorySummary;
import com.auratriage.ehr.api.SlotView;
import com.auratriage.ehr.api.VitalMetric;
import com.auratriage.ehr.api.VitalsTrend;
import com.auratriage.ehr.repo.InMemoryEhrRepository;
import java.lang.reflect.RecordComponent;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

class ClinicalServiceTest {

    static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-27T12:00:00Z"), ZoneOffset.UTC);

    private InMemoryEhrRepository repository;
    private ClinicalService service;

    @BeforeEach
    void setUp() {
        repository = new InMemoryEhrRepository(CLOCK);
        service = new ClinicalService(repository, CLOCK);
    }

    // --- get_patient_history

    @Test
    void summarisesAPatientWithTrendsEpisodesAndAgeBand() {
        PatientHistorySummary summary = service.getPatientHistory("P-1001");

        assertThat(summary.patientId()).isEqualTo("P-1001");
        assertThat(summary.ageBand()).isEqualTo("50-59");
        assertThat(summary.conditions()).containsExactly("hypertension", "type_2_diabetes");
        assertThat(summary.recentEncounters()).extracting(EncounterSummary::date)
                .containsExactly("2026-06-20", "2026-06-02", "2026-02-10", "2025-11-18", "2025-11-04");
        assertThat(summary.episodesOfCare()).extracting(EpisodeOfCare::encounterCount).containsExactly(2, 1, 2);
        assertThat(summary.vitalsTrends()).containsExactlyInAnyOrder(
                new VitalsTrend(VitalMetric.SYSTOLIC_BP, Direction.RISING, 3),
                new VitalsTrend(VitalMetric.HEART_RATE, Direction.STABLE, 3));
    }

    @Test
    void reportsAFallingHeartRateForTheRateControlledPatient() {
        assertThat(service.getPatientHistory("P-1003").vitalsTrends()).containsExactlyInAnyOrder(
                new VitalsTrend(VitalMetric.SYSTOLIC_BP, Direction.STABLE, 3),
                new VitalsTrend(VitalMetric.HEART_RATE, Direction.FALLING, 3));
    }

    @Test
    void groupsVeryOldPatientsAs90Plus() {
        assertThat(service.getPatientHistory("P-1005").ageBand()).isEqualTo("90+");
    }

    @Test
    void ageBandsUseTenYearBucketsAndCapAtNinety() {
        LocalDate today = LocalDate.of(2026, 10, 27);

        assertThat(ClinicalService.ageBand(LocalDate.of(1936, 10, 27), today)).isEqualTo("90+");
        assertThat(ClinicalService.ageBand(LocalDate.of(1936, 10, 28), today)).isEqualTo("80-89");
        assertThat(ClinicalService.ageBand(LocalDate.of(1996, 5, 21), today)).isEqualTo("30-39");
        assertThat(ClinicalService.ageBand(LocalDate.of(2026, 1, 1), today)).isEqualTo("0-9");
    }

    @Test
    void theSummaryTypeHasNoFieldThatCouldCarryIdentity() {
        assertThat(Arrays.stream(PatientHistorySummary.class.getRecordComponents()).map(RecordComponent::getName))
                .doesNotContain("name", "patientName", "dob", "dateOfBirth", "address", "phone", "email");
    }

    @Test
    void domainObjectsDoNotPrintPhiWhenFormatted() {
        String patient = repository.findPatient("P-1001").orElseThrow().toString();

        assertThat(patient).isEqualTo("Patient[id=P-1001]").doesNotContain("Quillfeather", "1971");
        assertThat(service.getPatientHistory("P-1001").toString()).doesNotContain("hypertension");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"P-12", "p-1001", "P-10010", "P-1001\n", "../etc/passwd", "P-1001; DROP TABLE"})
    void rejectsMalformedPatientIdsWithoutEchoingThem(String patientId) {
        assertThatThrownBy(() -> service.getPatientHistory(patientId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("patientId must look like P-1234");
    }

    @Test
    void unknownPatientIsReportedWithoutEchoingTheId() {
        assertThatThrownBy(() -> service.getPatientHistory("P-9999"))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessage("No patient with that ID");
    }

    // --- check_provider_availability

    @Test
    void returnsTheTenEarliestCardiologySlotsSoonestFirst() {
        AvailabilityResult result = service.checkProviderAvailability("cardiology");

        assertThat(result.specialty()).isEqualTo("cardiology");
        assertThat(result.slots()).hasSize(10);
        assertThat(result.slots()).extracting(SlotView::start).isSorted();
        assertThat(result.slots().getFirst().start()).isEqualTo("2026-10-28T09:00:00Z");
        assertThat(result.slots()).extracting(SlotView::providerName)
                .containsOnly("Dr. Soraya Lindqvist", "Dr. Tobias Wren");
    }

    @Test
    void normalisesSpecialtyText() {
        AvailabilityResult result = service.checkProviderAvailability("  Primary Care ");

        assertThat(result.specialty()).isEqualTo("primary_care");
        assertThat(result.slots()).isNotEmpty();
    }

    @Test
    void unknownSpecialtyHasNoSlots() {
        AvailabilityResult result = service.checkProviderAvailability("podiatry");

        assertThat(result.specialty()).isEqualTo("podiatry");
        assertThat(result.slots()).isEmpty();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"cardiology; drop table", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "cardio<script>"})
    void rejectsMalformedSpecialties(String specialty) {
        assertThatThrownBy(() -> service.checkProviderAvailability(specialty))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("specialty must be a name such as primary_care");
    }

    // --- book_appointment

    @Test
    void booksAnOpenSlot() {
        String slotId = firstCardiologySlot();

        BookingResult result = service.bookAppointment("P-1001", slotId);

        assertThat(result.status()).isEqualTo(BookingStatus.BOOKED);
        assertThat(result.appointmentId()).isEqualTo("A-0001");
        assertThat(result.slotId()).isEqualTo(slotId);
        assertThat(service.checkProviderAvailability("cardiology").slots())
                .extracting(SlotView::slotId)
                .doesNotContain(slotId);
    }

    @Test
    void bookingTheSameSlotAgainForTheSamePatientIsIdempotent() {
        String slotId = firstCardiologySlot();

        BookingResult first = service.bookAppointment("P-1001", slotId);
        BookingResult second = service.bookAppointment("P-1001", slotId);

        assertThat(second).isEqualTo(first);
    }

    @Test
    void anotherPatientCannotTakeABookedSlot() {
        String slotId = firstCardiologySlot();
        service.bookAppointment("P-1001", slotId);

        BookingResult result = service.bookAppointment("P-1002", slotId);

        assertThat(result.status()).isEqualTo(BookingStatus.SLOT_TAKEN);
        assertThat(result.appointmentId()).isNull();
    }

    @Test
    void unknownSlotIsReported() {
        assertThat(service.bookAppointment("P-1001", "S-9999").status()).isEqualTo(BookingStatus.SLOT_NOT_FOUND);
    }

    @Test
    void bookingRequiresAKnownPatientAndWellFormedIds() {
        String slotId = firstCardiologySlot();

        assertThatThrownBy(() -> service.bookAppointment("P-9999", slotId)).isInstanceOf(NoSuchElementException.class);
        assertThatThrownBy(() -> service.bookAppointment("bad", slotId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("patientId must look like P-1234");
        assertThatThrownBy(() -> service.bookAppointment("P-1001", "bad"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("slotId must look like S-1234");
    }

    @Test
    void exactlyOnePatientWinsAContestedSlot() throws Exception {
        String slotId = firstCardiologySlot();
        List<String> patients = List.of("P-1001", "P-1002", "P-1003", "P-1004", "P-1005");

        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<BookingResult>> attempts = patients.stream()
                    .map(patientId -> pool.submit(() -> service.bookAppointment(patientId, slotId)))
                    .toList();
            long winners = 0;
            for (Future<BookingResult> attempt : attempts) {
                if (attempt.get().status() == BookingStatus.BOOKED) {
                    winners++;
                }
            }
            assertThat(winners).isEqualTo(1);
        }
    }

    private String firstCardiologySlot() {
        return service.checkProviderAvailability("cardiology").slots().getFirst().slotId();
    }
}
