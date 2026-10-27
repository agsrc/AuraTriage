package com.auratriage.ehr.domain;

import java.time.Instant;

/** A bookable appointment slot. Whether it is taken is tracked by the repository, not here. */
public record Slot(String slotId, String providerId, Instant start, int durationMinutes) {}
