package com.auratriage.ehr.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.auratriage.ehr.repo.InMemoryEhrRepository;
import com.auratriage.ehr.service.ClinicalService;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.tool.ToolCallback;

/** Checks the MCP-facing tool definitions without starting Spring (and so without the stdio transport). */
class ToolConfigTest {

    private Map<String, ToolCallback> tools;

    @BeforeEach
    void setUp() {
        Clock clock = Clock.fixed(Instant.parse("2026-10-27T12:00:00Z"), ZoneOffset.UTC);
        ClinicalService service = new ClinicalService(new InMemoryEhrRepository(clock), clock);
        tools = Arrays.stream(new ToolConfig().ehrTools(service).getToolCallbacks())
                .collect(Collectors.toMap(tool -> tool.getToolDefinition().name(), tool -> tool));
    }

    @Test
    void exposesExactlyTheDocumentedTools() {
        assertThat(tools.keySet())
                .containsExactlyInAnyOrder("get_patient_history", "check_provider_availability", "book_appointment");
    }

    @Test
    void readOnlyToolsSayTheyAreReadOnly() {
        assertThat(description("get_patient_history")).startsWith("Read-only.");
        assertThat(description("check_provider_availability")).startsWith("Read-only.");
    }

    @Test
    void theStateChangingToolSaysSo() {
        assertThat(description("book_appointment")).startsWith("STATE-CHANGING.");
    }

    @Test
    void patientAndSlotIdsAreRequiredInputs() {
        assertThat(inputSchema("get_patient_history")).contains("patientId", "required");
        assertThat(inputSchema("book_appointment")).contains("patientId", "slotId", "required");
        assertThat(inputSchema("check_provider_availability")).contains("specialty", "required");
    }

    @Test
    void noToolSchemaMentionsIdentityFields() {
        List<String> forbidden = List.of("dateOfBirth", "dob", "address", "patientName");
        tools.values().forEach(tool -> assertThat(tool.getToolDefinition().inputSchema())
                .doesNotContain(forbidden.toArray(String[]::new)));
    }

    private String description(String tool) {
        return tools.get(tool).getToolDefinition().description();
    }

    private String inputSchema(String tool) {
        return tools.get(tool).getToolDefinition().inputSchema();
    }
}
