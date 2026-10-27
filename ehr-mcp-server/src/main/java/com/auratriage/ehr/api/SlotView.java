package com.auratriage.ehr.api;

/** An open slot. {@code start} is an ISO-8601 UTC instant, for example {@code 2026-10-28T09:00:00Z}. */
public record SlotView(String slotId, String providerId, String providerName, String start, int durationMinutes) {}
