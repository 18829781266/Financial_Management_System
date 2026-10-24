package com.langchao.archive.service;

import com.langchao.archive.api.ApiException;
import com.langchao.archive.mapper.ArchiveBookMapper;
import com.langchao.archive.mapper.MatchRelationMapper;
import com.langchao.archive.mapper.SourceDocumentMapper;
import com.langchao.archive.mapper.SysLogMapper;
import com.langchao.archive.mapper.VoucherMapper;
import com.langchao.archive.model.ArchiveBook;
import com.langchao.archive.storage.FileStorage;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ArchiveServiceTest {
    @TempDir Path directory;

    @Test void mergesVoucherPdfAndImageInInputOrderAndHashesRealBytes() throws Exception {
        Path voucher = directory.resolve("voucher.pdf");
        try (PDDocument document = new PDDocument()) {
            PDPage page = new PDPage(); document.addPage(page);
            try (PDPageContentStream content = new PDPageContentStream(document, page)) {
                content.beginText(); content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                content.newLineAtOffset(40, 700); content.showText("Voucher 001"); content.endText();
            }
            document.save(voucher.toFile());
        }
        Path invoice = directory.resolve("invoice.png");
        ImageIO.write(new BufferedImage(100, 60, BufferedImage.TYPE_INT_RGB), "png", invoice.toFile());
        Path output = directory.resolve("book.pdf");
        ArchiveService.merge(List.of(voucher, invoice), output);
        try (PDDocument result = Loader.loadPDF(output.toFile())) {
            assertEquals(2, result.getNumberOfPages());
            assertTrue(new PDFTextStripper().getText(result).contains("Voucher 001"));
            assertTrue(result.getPage(1).getResources().getXObjectNames().iterator().hasNext());
        }
        String hash = ArchiveService.sha256(output);
        assertEquals(64, hash.length());
        assertEquals(hash, ArchiveService.sha256(output));
        Files.writeString(output, "tampered");
        assertNotEquals(hash, ArchiveService.sha256(output));
    }

    @Test void downloadDetectsTamperingAgainstPersistedHash() throws Exception {
        String url = "/files/" + UUID.randomUUID() + ".pdf";
        FileStorage storage = new FileStorage(directory.toString());
        Path file = storage.resolve(url); Files.writeString(file, "original");
        ArchiveBook book = new ArchiveBook(); book.setId(1L); book.setStatus("LOCKED");
        book.setPdfUrl(url); book.setHashCode(ArchiveService.sha256(file));
        ArchiveBookMapper mapper = mock(ArchiveBookMapper.class); when(mapper.selectById(1L)).thenReturn(book);
        ArchiveService service = new ArchiveService(mapper, mock(VoucherMapper.class), mock(SourceDocumentMapper.class),
                mock(MatchRelationMapper.class), mock(SysLogMapper.class), storage, mock(JdbcTemplate.class));
        assertTrue(service.pdf(1L).exists());
        Files.writeString(file, "tampered");
        assertThrows(ApiException.class, () -> service.pdf(1L));
    }
}
