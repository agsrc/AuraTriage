package com.auratriage.ehr.config;

import com.auratriage.ehr.service.ClinicalService;
import java.time.Clock;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.ai.tool.method.MethodToolCallbackProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class ToolConfig {

    /** Registers every {@code @Tool} method of {@link ClinicalService} as an MCP tool. */
    @Bean
    public ToolCallbackProvider ehrTools(ClinicalService clinicalService) {
        return MethodToolCallbackProvider.builder().toolObjects(clinicalService).build();
    }

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
