package com.auratriage.ehr;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Mock EHR exposed to AI agents over MCP (stdio). Synthetic data only.
 *
 * <p>stdout is the JSON-RPC channel: nothing in this module may write to it.
 */
@SpringBootApplication
public class EhrMcpServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(EhrMcpServerApplication.class, args);
    }
}
