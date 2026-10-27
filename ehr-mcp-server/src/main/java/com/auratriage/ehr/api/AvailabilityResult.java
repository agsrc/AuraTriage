package com.auratriage.ehr.api;

import java.util.List;

/** Earliest open slots for one specialty, soonest first. */
public record AvailabilityResult(String specialty, List<SlotView> slots) {}
