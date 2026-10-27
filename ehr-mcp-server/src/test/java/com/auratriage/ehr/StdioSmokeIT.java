package com.auratriage.ehr;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Launches the packaged JAR exactly as the orchestrator will (a child process speaking MCP over
 * stdin/stdout) and talks JSON-RPC to it. Runs in the failsafe phase, after {@code package}.
 */
class StdioSmokeIT {

    private static final long TIMEOUT_SECONDS = 60;
    private static final String CANARY_NAME = "Quillfeather";
    private static final String CANARY_DOB = "1971-03-14";
    private static final Pattern SLOT_ID = Pattern.compile("S-\\d{4}");

    private final BlockingQueue<String> stdoutLines = new LinkedBlockingQueue<>();
    private final List<String> allStdoutLines = new CopyOnWriteArrayList<>();
    private Process process;
    private Writer stdin;

    @BeforeEach
    void startServer() throws IOException {
        Path jar = Path.of(System.getProperty("ehr.jar", "target/ehr-mcp-server.jar"));
        assertThat(jar).as("packaged JAR").exists();
        String java = ProcessHandle.current()
                .info()
                .command()
                .orElseGet(() -> Path.of(System.getProperty("java.home"), "bin", "java").toString());

        process = new ProcessBuilder(java, "-jar", jar.toString())
                .redirectError(ProcessBuilder.Redirect.INHERIT)
                .start();
        stdin = new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8);
        Thread reader = new Thread(() -> readStdout(process.getInputStream()), "ehr-stdout-reader");
        reader.setDaemon(true);
        reader.start();
    }

    @AfterEach
    void stopServer() throws Exception {
        stdin.close();
        if (!process.waitFor(10, TimeUnit.SECONDS)) {
            process.destroyForcibly();
        }
    }

    @Test
    void stdoutCarriesOnlyJsonRpcAndExposesTheDocumentedTools() throws Exception {
        String init = initialize();
        assertThat(init).startsWith("{").contains("\"jsonrpc\":\"2.0\"").contains("ehr-mcp-server");

        String tools = call(2, "tools/list", "{}");
        assertThat(tools).contains("get_patient_history", "check_provider_availability", "book_appointment");

        String history = callTool(3, "get_patient_history", "{\"patientId\":\"P-1001\"}");
        assertThat(history)
                .contains("ageBand", "rising", "hypertension")
                .doesNotContain("\"isError\":true")
                .doesNotContain(CANARY_NAME, CANARY_DOB, "dateOfBirth", "address");

        String invalid = callTool(4, "get_patient_history", "{\"patientId\":\"not-an-id\"}");
        assertThat(invalid).contains("\"isError\":true").doesNotContain("not-an-id");

        assertThat(allStdoutLines)
                .isNotEmpty()
                .allSatisfy(line -> assertThat(line).startsWith("{").endsWith("}"));
    }

    @Test
    void bookingWorksEndToEndOverTheTransport() throws Exception {
        initialize();

        String availability = callTool(2, "check_provider_availability", "{\"specialty\":\"cardiology\"}");
        Matcher slot = SLOT_ID.matcher(availability);
        assertThat(slot.find()).as("a slot ID in the availability result").isTrue();

        String booked = callTool(3, "book_appointment", "{\"patientId\":\"P-1001\",\"slotId\":\"" + slot.group() + "\"}");
        assertThat(booked).contains("booked", "A-0001").doesNotContain("\"isError\":true");

        String taken = callTool(4, "book_appointment", "{\"patientId\":\"P-1002\",\"slotId\":\"" + slot.group() + "\"}");
        assertThat(taken).contains("slot_taken");
    }

    @Test
    void exitsWhenStdinCloses() throws Exception {
        initialize();

        stdin.close();

        assertThat(process.waitFor(15, TimeUnit.SECONDS)).as("server exits after stdin EOF").isTrue();
    }

    private String initialize() throws Exception {
        String response = call(
                1,
                "initialize",
                "{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},"
                        + "\"clientInfo\":{\"name\":\"stdio-smoke-it\",\"version\":\"0\"}}");
        send("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}");
        return response;
    }

    private String callTool(int id, String tool, String argumentsJson) throws Exception {
        return call(id, "tools/call", "{\"name\":\"" + tool + "\",\"arguments\":" + argumentsJson + "}");
    }

    private String call(int id, String method, String paramsJson) throws Exception {
        send("{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"method\":\"" + method + "\",\"params\":" + paramsJson + "}");
        String line = stdoutLines.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(line).as("a stdout line within %d s for %s", TIMEOUT_SECONDS, method).isNotNull();
        assertThat(line).contains("\"id\":" + id);
        return line;
    }

    private void send(String json) throws IOException {
        stdin.write(json);
        stdin.write('\n');
        stdin.flush();
    }

    private void readStdout(InputStream in) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                allStdoutLines.add(line);
                stdoutLines.add(line);
            }
        } catch (IOException ignored) {
            // the process ended; nothing more to read
        }
    }
}
