package com.langchao.archive.storage;

import com.langchao.archive.api.ApiException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class FileStorageTest {
    @TempDir Path directory;

    @Test void trustsMagicBytesRatherThanOriginalFilename() throws Exception {
        FileStorage storage = new FileStorage(directory.toString());
        String url = storage.store(new MockMultipartFile("file", "../../attack.exe", "image/png", "%PDF-1.7\nfixture".getBytes()));
        assertTrue(url.matches("/files/[0-9a-f-]{36}\\.pdf"));
        assertTrue(Files.exists(storage.resolve(url)));
    }

    @Test void rejectsPathTraversalExternalUrlsAndExecutableUpload() {
        FileStorage storage = new FileStorage(directory.toString());
        assertThrows(ApiException.class, () -> storage.resolve("/files/../../etc/passwd"));
        assertThrows(ApiException.class, () -> storage.resolve("https://example.com/invoice.pdf"));
        assertThrows(ApiException.class, () -> storage.store(new MockMultipartFile("file", "invoice.pdf", "application/pdf", "MZ executable".getBytes())));
        assertThrows(ApiException.class, () -> storage.store(new MockMultipartFile("file", new byte[0])));
    }
}
