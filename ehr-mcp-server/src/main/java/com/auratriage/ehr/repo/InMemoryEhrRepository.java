package com.auratriage.ehr.repo;

import com.auratriage.ehr.domain.Booking;
import com.auratriage.ehr.domain.Patient;
import com.auratriage.ehr.domain.Provider;
import com.auratriage.ehr.domain.Slot;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Repository;

/** In-memory stand-in for the legacy EHR database. Seeded with synthetic data at start-up. */
@Repository
public class InMemoryEhrRepository {

    private final Map<String, Patient> patients = new ConcurrentHashMap<>();
    private final Map<String, Provider> providers = new ConcurrentHashMap<>();
    private final Map<String, Slot> slots = new ConcurrentHashMap<>();
    private final Map<String, Booking> bookingsBySlot = new ConcurrentHashMap<>();
    private final AtomicInteger appointmentSequence = new AtomicInteger();

    public InMemoryEhrRepository(Clock clock) {
        SeedData.patients().forEach(patient -> patients.put(patient.id(), patient));
        List<Provider> seededProviders = SeedData.providers();
        seededProviders.forEach(provider -> providers.put(provider.id(), provider));
        SeedData.slots(seededProviders, LocalDate.now(clock))
                .forEach(slot -> slots.put(slot.slotId(), slot));
    }

    public Optional<Patient> findPatient(String patientId) {
        return Optional.ofNullable(patients.get(patientId));
    }

    public List<Provider> findProvidersBySpecialty(String specialty) {
        return providers.values().stream()
                .filter(provider -> provider.specialty().equals(specialty))
                .sorted(Comparator.comparing(Provider::id))
                .toList();
    }

    public Optional<Slot> findSlot(String slotId) {
        return Optional.ofNullable(slots.get(slotId));
    }

    /** Open slots of one provider, earliest first. */
    public List<Slot> findOpenSlots(String providerId) {
        return slots.values().stream()
                .filter(slot -> slot.providerId().equals(providerId))
                .filter(slot -> !bookingsBySlot.containsKey(slot.slotId()))
                .sorted(Comparator.comparing(Slot::start).thenComparing(Slot::slotId))
                .toList();
    }

    /**
     * Atomically claims a slot. Returns the booking that holds the slot: a new one if the slot was
     * open, otherwise the existing one. Callers compare {@link Booking#patientId()} to tell whether
     * the claim succeeded, which makes repeated calls by the same patient idempotent.
     */
    public Booking claimSlot(String slotId, String patientId) {
        return bookingsBySlot.computeIfAbsent(
                slotId,
                id -> new Booking("A-%04d".formatted(appointmentSequence.incrementAndGet()), id, patientId));
    }
}
