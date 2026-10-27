package com.auratriage.ehr.service;

import com.auratriage.ehr.api.AvailabilityResult;
import com.auratriage.ehr.api.BookingResult;
import com.auratriage.ehr.api.EncounterSummary;
import com.auratriage.ehr.api.EpisodeOfCare;
import com.auratriage.ehr.api.PatientHistorySummary;
import com.auratriage.ehr.api.SlotView;
import com.auratriage.ehr.domain.Booking;
import com.auratriage.ehr.domain.Encounter;
import com.auratriage.ehr.domain.Patient;
import com.auratriage.ehr.domain.Provider;
import com.auratriage.ehr.domain.Slot;
import com.auratriage.ehr.repo.InMemoryEhrRepository;
import com.auratriage.ehr.transform.AvailabilityAggregator;
import com.auratriage.ehr.transform.EpisodeGatherers;
import com.auratriage.ehr.transform.VitalsTrendAnalyzer;
import java.time.Clock;
import java.time.LocalDate;
import java.time.Period;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.NoSuchElementException;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Service;

/**
 * The MCP tools. Every method annotated with {@code @Tool} is exposed to the agent, so each one
 * validates its own input and returns minimum-necessary data.
 *
 * <p>Logging rule: log opaque IDs only. Never log a name, date of birth, address or clinical text.
 * Error messages must not echo caller-supplied input.
 */
@Service
public class ClinicalService {

    static final int MAX_RECENT_ENCOUNTERS = 5;
    static final int MAX_SLOTS = 10;
    static final int EPISODE_MAX_GAP_DAYS = 30;

    private static final Logger log = LoggerFactory.getLogger(ClinicalService.class);
    private static final Pattern PATIENT_ID = Pattern.compile("^P-\\d{4}$");
    private static final Pattern SLOT_ID = Pattern.compile("^S-\\d{4}$");
    private static final Pattern SPECIALTY = Pattern.compile("^[a-z_]{1,40}$");

    private final InMemoryEhrRepository repository;
    private final Clock clock;
    private final VitalsTrendAnalyzer vitalsTrendAnalyzer = new VitalsTrendAnalyzer();

    public ClinicalService(InMemoryEhrRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Tool(
            name = "get_patient_history",
            description = "Read-only. Returns a minimum-necessary clinical summary for one patient: age band, "
                    + "conditions, medications, allergies, the 5 most recent encounters, episodes of care and "
                    + "vitals trends. Never returns name, date of birth or address.")
    public PatientHistorySummary getPatientHistory(
            @ToolParam(description = "Patient ID in the form P-1234") String patientId) {
        requirePatientId(patientId);
        Patient patient = repository
                .findPatient(patientId)
                .orElseThrow(() -> new NoSuchElementException("No patient with that ID"));
        log.debug("get_patient_history patientId={}", patientId);

        List<Encounter> chronological = patient.encounters().stream()
                .sorted(Comparator.comparing(Encounter::date))
                .toList();
        List<EpisodeOfCare> episodes = chronological.stream()
                .gather(EpisodeGatherers.episodesOfCare(EPISODE_MAX_GAP_DAYS))
                .toList();
        List<EncounterSummary> recent = chronological.reversed().stream()
                .limit(MAX_RECENT_ENCOUNTERS)
                .map(encounter -> new EncounterSummary(
                        encounter.date().toString(), encounter.type(), encounter.summary()))
                .toList();

        return new PatientHistorySummary(
                patient.id(),
                ageBand(patient.dateOfBirth(), LocalDate.now(clock)),
                patient.conditions(),
                patient.medications(),
                patient.allergies(),
                recent,
                episodes,
                vitalsTrendAnalyzer.analyze(patient.vitals()));
    }

    @Tool(
            name = "check_provider_availability",
            description = "Read-only. Lists the earliest open appointment slots (at most 10, soonest first) for a "
                    + "specialty. Valid specialties: primary_care, cardiology, dermatology, neurology.")
    public AvailabilityResult checkProviderAvailability(
            @ToolParam(description = "Specialty, one of: primary_care, cardiology, dermatology, neurology")
                    String specialty) {
        String normalized = normalizeSpecialty(specialty);
        log.debug("check_provider_availability specialty={}", normalized);

        List<Provider> providers = repository.findProvidersBySpecialty(normalized);
        List<Slot> earliest = AvailabilityAggregator.earliestOpenSlots(
                providers, provider -> repository.findOpenSlots(provider.id()), MAX_SLOTS);
        List<SlotView> views = earliest.stream()
                .map(slot -> toView(slot, providers))
                .toList();
        return new AvailabilityResult(normalized, views);
    }

    @Tool(
            name = "book_appointment",
            description = "STATE-CHANGING. Books one open slot for a patient. Call only after the patient has "
                    + "explicitly confirmed this exact slot. Safe to repeat for the same patient and slot.")
    public BookingResult bookAppointment(
            @ToolParam(description = "Patient ID in the form P-1234") String patientId,
            @ToolParam(description = "Slot ID in the form S-1234, taken from check_provider_availability")
                    String slotId) {
        requirePatientId(patientId);
        requireSlotId(slotId);
        repository
                .findPatient(patientId)
                .orElseThrow(() -> new NoSuchElementException("No patient with that ID"));
        if (repository.findSlot(slotId).isEmpty()) {
            return BookingResult.slotNotFound(slotId);
        }

        Booking holder = repository.claimSlot(slotId, patientId);
        log.debug("book_appointment patientId={} slotId={} appointmentId={}", patientId, slotId, holder.appointmentId());
        return holder.patientId().equals(patientId)
                ? BookingResult.booked(holder.appointmentId(), slotId)
                : BookingResult.slotTaken(slotId);
    }

    /**
     * Ten-year band, with everyone aged 90 or over grouped as "90+" (HIPAA Safe Harbor does not allow
     * reporting exact ages above 89).
     */
    static String ageBand(LocalDate dateOfBirth, LocalDate today) {
        int age = Period.between(dateOfBirth, today).getYears();
        if (age >= 90) {
            return "90+";
        }
        int lower = (age / 10) * 10;
        return lower + "-" + (lower + 9);
    }

    private static SlotView toView(Slot slot, List<Provider> providers) {
        String providerName = providers.stream()
                .filter(provider -> provider.id().equals(slot.providerId()))
                .findFirst()
                .map(Provider::name)
                .orElse("Unknown provider");
        return new SlotView(
                slot.slotId(), slot.providerId(), providerName, slot.start().toString(), slot.durationMinutes());
    }

    private static String normalizeSpecialty(String specialty) {
        if (specialty == null) {
            throw new IllegalArgumentException("specialty must be a name such as primary_care");
        }
        String normalized = specialty.trim().toLowerCase(Locale.ROOT).replace(' ', '_').replace('-', '_');
        if (!SPECIALTY.matcher(normalized).matches()) {
            throw new IllegalArgumentException("specialty must be a name such as primary_care");
        }
        return normalized;
    }

    private static void requirePatientId(String patientId) {
        if (patientId == null || !PATIENT_ID.matcher(patientId).matches()) {
            throw new IllegalArgumentException("patientId must look like P-1234");
        }
    }

    private static void requireSlotId(String slotId) {
        if (slotId == null || !SLOT_ID.matcher(slotId).matches()) {
            throw new IllegalArgumentException("slotId must look like S-1234");
        }
    }
}
