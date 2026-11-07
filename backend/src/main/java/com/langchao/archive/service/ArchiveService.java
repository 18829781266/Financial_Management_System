package com.langchao.archive.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.langchao.archive.api.ApiException;
import com.langchao.archive.mapper.ArchiveBookMapper;
import com.langchao.archive.mapper.MatchRelationMapper;
import com.langchao.archive.mapper.SourceDocumentMapper;
import com.langchao.archive.mapper.SysLogMapper;
import com.langchao.archive.mapper.VoucherMapper;
import com.langchao.archive.model.ArchiveBook;
import com.langchao.archive.model.MatchRelation;
import com.langchao.archive.model.SourceDocument;
import com.langchao.archive.model.SysLog;
import com.langchao.archive.model.Voucher;
import com.langchao.archive.storage.FileStorage;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.springframework.core.io.Resource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** 档案合规校验、顺序合并、防篡改校验及只读锁定。 */
@Service
public class ArchiveService {
    private static final BigDecimal AMOUNT_TOLERANCE = new BigDecimal("0.05");
    private static final Pattern NUMBER = Pattern.compile("^(.*?)(\\d+)$");
    private static final int MAX_PAGES = 5000;
    private final ArchiveBookMapper archives;
    private final VoucherMapper vouchers;
    private final SourceDocumentMapper documents;
    private final MatchRelationMapper relations;
    private final SysLogMapper logs;
    private final FileStorage storage;
    private final JdbcTemplate jdbc;

    public ArchiveService(ArchiveBookMapper archives, VoucherMapper vouchers, SourceDocumentMapper documents,
                          MatchRelationMapper relations, SysLogMapper logs, FileStorage storage, JdbcTemplate jdbc) {
        this.archives = archives; this.vouchers = vouchers; this.documents = documents;
        this.relations = relations; this.logs = logs; this.storage = storage; this.jdbc = jdbc;
    }

    @Transactional(rollbackFor = Exception.class)
    public ArchiveBook generate(String period, String startVoucherNo, String endVoucherNo, String actor) {
        VoucherNumber start = number(startVoucherNo), end = number(endVoucherNo);
        if (!start.prefix().equals(end.prefix()) || start.sequence() > end.sequence()) {
            throw new ApiException(400, "凭证号范围必须使用相同字别且起始序号不大于结束序号");
        }
        // 按固定顺序锁定所有凭证；与匹配写入共享数据库行锁。两个重叠档案任务不会重复归档。
        List<Voucher> selected = vouchers.selectList(new QueryWrapper<Voucher>().eq("period", period)
                .between("voucher_sequence", start.sequence(), end.sequence()).likeRight("voucher_no", start.prefix())
                .orderByAsc("id").last("FOR UPDATE"));
        selected = selected.stream().filter(v -> number(v.getVoucherNo()).prefix().equals(start.prefix()))
                .sorted(Comparator.comparing(Voucher::getVoucherSequence)).toList();
        if (selected.isEmpty() || selected.stream().noneMatch(v -> startVoucherNo.equals(v.getVoucherNo()))
                || selected.stream().noneMatch(v -> endVoucherNo.equals(v.getVoucherNo()))) {
            throw new ApiException(422, "所选期间中不存在完整的起止凭证");
        }
        if (selected.stream().anyMatch(v -> !"MATCHED".equals(v.getStatus()))) {
            throw new ApiException(409, "范围包含待匹配、附件缺失或已锁定凭证，无法归档");
        }
        List<Long> voucherIds = selected.stream().map(Voucher::getId).toList();
        List<MatchRelation> bindings = relations.selectList(new QueryWrapper<MatchRelation>()
                .in("voucher_id", voucherIds).orderByAsc("id"));
        Set<Long> documentIds = bindings.stream().map(MatchRelation::getDocId).collect(Collectors.toSet());
        if (documentIds.isEmpty()) { throw new ApiException(422, "凭证缺少原始单据"); }
        List<SourceDocument> lockedDocuments = documents.selectList(new QueryWrapper<SourceDocument>()
                .in("id", documentIds).orderByAsc("id").last("FOR UPDATE"));
        Map<Long, SourceDocument> byId = lockedDocuments.stream().collect(Collectors.toMap(SourceDocument::getId, Function.identity()));
        if (byId.size() != documentIds.size()) { throw new ApiException(422, "关联单据已不存在"); }
        Map<Long, List<MatchRelation>> byVoucher = bindings.stream().collect(Collectors.groupingBy(MatchRelation::getVoucherId));
        List<Path> inputs = new ArrayList<>();
        for (Voucher voucher : selected) {
            List<MatchRelation> attachments = byVoucher.getOrDefault(voucher.getId(), List.of());
            validateVoucher(voucher, attachments);
            // 每张记账凭证后紧接其原始单据，单据按类型、业务日期和主键稳定排序。
            inputs.add(requiredFile(voucher.getImageUrl(), "凭证 " + voucher.getVoucherNo()));
            List<SourceDocument> ordered = attachments.stream().map(r -> byId.get(r.getDocId())).distinct()
                    .sorted(Comparator.comparingInt((SourceDocument d) -> documentOrder(d.getDocType()))
                            .thenComparing(SourceDocument::getDocumentDate, Comparator.nullsLast(Comparator.naturalOrder()))
                            .thenComparing(SourceDocument::getId)).toList();
            for (SourceDocument document : ordered) {
                if ("INVOICE".equalsIgnoreCase(document.getDocType()) && !Boolean.TRUE.equals(document.getSealPresent())) {
                    throw new ApiException(422, "发票 " + document.getId() + " 缺少已核验的有效印章");
                }
                if (!Set.of("MATCHED", "LOCKED").contains(Objects.toString(document.getStatus(), ""))) {
                    throw new ApiException(422, "单据 " + document.getId() + " 尚未完成匹配");
                }
                Path image = requiredFile(document.getImageUrl(), "单据 " + document.getId());
                verifySourceHash(document, image);
                inputs.add(image);
            }
        }
        // 多凭证共用同一单据时，所有分摊额之和必须与单据面额一致，防止重复分配。
        for (SourceDocument document : lockedDocuments) {
            BigDecimal allocated = relations.selectList(new QueryWrapper<MatchRelation>().eq("doc_id", document.getId()))
                    .stream().map(MatchRelation::getAllocatedAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
            if (document.getAmount() == null || allocated.subtract(document.getAmount()).abs().compareTo(AMOUNT_TOLERANCE) > 0) {
                throw new ApiException(422, "单据 " + document.getId() + " 的分摊金额与原始面额不一致");
            }
        }
        String outputUrl = null;
        Path temporary = null;
        try {
            temporary = storage.temporary();
            merge(inputs, temporary);
            String hash = sha256(temporary);
            outputUrl = storage.commit(temporary, "pdf");
            String publishedUrl = outputUrl;
            // 数据库提交失败时移除新档案，避免出现没有数据库记录的孤立文件。
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED) { storage.delete(publishedUrl); }
                    }
                });
            }
            ArchiveBook book = new ArchiveBook();
            book.setPeriod(period); book.setStartVoucherNo(startVoucherNo); book.setEndVoucherNo(endVoucherNo);
            book.setStartVoucherSequence(start.sequence()); book.setEndVoucherSequence(end.sequence());
            book.setPdfUrl(outputUrl); book.setHashCode(hash); book.setStatus("LOCKED"); book.setCreatedAt(LocalDateTime.now());
            book.setVoucherCount(selected.size()); book.setDocumentCount(documentIds.size()); book.setCreator(actor);
            archives.insert(book);
            vouchers.update(null, new UpdateWrapper<Voucher>().in("id", voucherIds).set("status", "LOCKED"));
            documents.update(null, new UpdateWrapper<SourceDocument>().in("id", documentIds).set("status", "LOCKED"));
            SysLog log = new SysLog(); log.setAction("ARCHIVE_GENERATE"); log.setTargetType("ARCHIVE_BOOK");
            log.setTargetId(book.getId().toString()); log.setOperator(actor); log.setDetail("SHA-256=" + hash);
            log.setCreatedAt(LocalDateTime.now()); logs.insert(log);
            return book;
        } catch (IOException exception) {
            if (outputUrl != null) { storage.delete(outputUrl); }
            throw new ApiException(422, "档案影像不可读取或 PDF 合并失败");
        } catch (RuntimeException exception) {
            if (outputUrl != null && !TransactionSynchronizationManager.isSynchronizationActive()) { storage.delete(outputUrl); }
            throw exception;
        } finally {
            if (temporary != null) {
                try { Files.deleteIfExists(temporary); } catch (IOException ignored) { /* 已发布文件另有事务回滚清理。 */ }
            }
        }
    }

    public Page<ArchiveBook> search(String period, String keyword, BigDecimal minAmount, BigDecimal maxAmount, long page, long size) {
        return search(period, null, null, null, null, keyword, minAmount, maxAmount, page, size);
    }

    public Page<ArchiveBook> search(String period, String voucherNo, String invoiceNo, String contractNo,
                                    String supplierName, String keyword, BigDecimal minAmount, BigDecimal maxAmount, long page, long size) {
        if (page < 1 || size < 1 || size > 100 || (minAmount != null && maxAmount != null && minAmount.compareTo(maxAmount) > 0)) {
            throw new ApiException(400, "分页参数或金额范围无效");
        }
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> arguments = new ArrayList<>();
        if (period != null && !period.isBlank()) { where.append(" AND a.period=?"); arguments.add(period); }
        boolean hasKeyword = hasText(keyword);
        if (hasKeyword || hasText(voucherNo) || hasText(invoiceNo) || hasText(contractNo) || hasText(supplierName) || minAmount != null || maxAmount != null) {
            where.append(" AND EXISTS (SELECT 1 FROM voucher v WHERE v.period=a.period AND v.voucher_sequence BETWEEN a.start_voucher_sequence AND a.end_voucher_sequence");
            // 精确字别由凭证号前缀约束，避免同期间不同字别的同序号凭证串入检索结果。
            where.append(" AND REGEXP_REPLACE(v.voucher_no,'[0-9]+$','')=REGEXP_REPLACE(a.start_voucher_no,'[0-9]+$','')");
            if (hasText(voucherNo)) { where.append(" AND v.voucher_no LIKE ?"); arguments.add("%" + voucherNo.trim() + "%"); }
            addDimension(where, arguments, "invoice_no", invoiceNo);
            addDimension(where, arguments, "contract_no", contractNo);
            addDimension(where, arguments, "supplier_name", supplierName);
            if (minAmount != null) { where.append(" AND v.amount>=?"); arguments.add(minAmount); }
            if (maxAmount != null) { where.append(" AND v.amount<=?"); arguments.add(maxAmount); }
            if (hasKeyword) {
                where.append(" AND (v.voucher_no LIKE ? OR v.supplier_name LIKE ? OR v.invoice_no LIKE ? OR v.contract_no LIKE ? OR MATCH(v.summary,v.supplier_name) AGAINST (? IN NATURAL LANGUAGE MODE) OR EXISTS (SELECT 1 FROM match_relation r JOIN source_document d ON d.id=r.doc_id WHERE r.voucher_id=v.id AND (d.invoice_no LIKE ? OR d.contract_no LIKE ? OR d.supplier_name LIKE ?)))");
                String like = "%" + keyword.trim() + "%";
                for (int index = 0; index < 4; index++) { arguments.add(like); }
                arguments.add(keyword.trim());
                for (int index = 0; index < 3; index++) { arguments.add(like); }
            }
            where.append(")");
        }
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM archive_book a" + where, Long.class, arguments.toArray());
        List<Object> paged = new ArrayList<>(arguments); paged.add(size); paged.add((page - 1) * size);
        List<Long> ids = jdbc.queryForList("SELECT a.id FROM archive_book a" + where + " ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?", Long.class, paged.toArray());
        Map<Long, ArchiveBook> records = ids.isEmpty() ? Map.of() : archives.selectBatchIds(ids).stream()
                .collect(Collectors.toMap(ArchiveBook::getId, Function.identity(), (left, right) -> left, LinkedHashMap::new));
        return new Page<ArchiveBook>(page, size, total == null ? 0 : total).setRecords(ids.stream().map(records::get).toList());
    }

    private static boolean hasText(String value) { return value != null && !value.isBlank(); }

    private static void addDimension(StringBuilder where, List<Object> arguments, String fixedColumn, String value) {
        // 列名只由本类内固定常量传入；所有用户输入都采用 JDBC 绑定变量。
        if (!hasText(value)) { return; }
        where.append(" AND (v.").append(fixedColumn).append(" LIKE ? OR EXISTS (SELECT 1 FROM match_relation r JOIN source_document d ON d.id=r.doc_id WHERE r.voucher_id=v.id AND d.")
                .append(fixedColumn).append(" LIKE ?))");
        String like = "%" + value.trim() + "%"; arguments.add(like); arguments.add(like);
    }

    /** 通用影像预览也经过档案校验，避免绕过专用 PDF 下载接口的完整性检查。 */
    public Resource file(String internalUrl) {
        storage.resolve(internalUrl);
        ArchiveBook archived = archives.selectOne(new QueryWrapper<ArchiveBook>().eq("pdf_url", internalUrl));
        return archived == null ? storage.resource(internalUrl) : pdf(archived.getId());
    }

    /** 每次下载重新核验哈希。数据库哈希只是完整性基线，不等同于可信时间戳/法定电子签章。 */
    public Resource pdf(long id) {
        ArchiveBook book = archives.selectById(id);
        if (book == null) { throw new ApiException(404, "档案册不存在"); }
        if (!"LOCKED".equals(book.getStatus())) { throw new ApiException(409, "档案尚未锁定"); }
        Path file = requiredFile(book.getPdfUrl(), "档案册");
        try {
            if (!MessageDigest.isEqual(sha256(file).getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                    Objects.toString(book.getHashCode(), "").getBytes(java.nio.charset.StandardCharsets.US_ASCII))) {
                throw new ApiException(409, "档案完整性校验失败，文件可能已被修改");
            }
            return storage.resource(book.getPdfUrl());
        } catch (IOException exception) { throw new ApiException(500, "无法核验档案完整性"); }
    }

    private void validateVoucher(Voucher voucher, List<MatchRelation> attachments) {
        long actual = attachments.stream().map(MatchRelation::getDocId).distinct().count();
        if (actual == 0 || voucher.getExpectedAttachmentCount() == null || actual != voucher.getExpectedAttachmentCount()) {
            throw new ApiException(422, "凭证 " + voucher.getVoucherNo() + " 附件数量与预期不一致");
        }
        if (attachments.stream().anyMatch(r -> r.getAllocatedAmount() == null || r.getAllocatedAmount().signum() < 0)) {
            throw new ApiException(422, "凭证存在无效分摊金额");
        }
        BigDecimal amount = attachments.stream().map(MatchRelation::getAllocatedAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        // BigDecimal 做十进制相减，禁止 double 引入 0.01 尾差附近的二进制舍入误判。
        if (voucher.getAmount() == null || amount.subtract(voucher.getAmount()).abs().compareTo(AMOUNT_TOLERANCE) > 0) {
            throw new ApiException(422, "凭证 " + voucher.getVoucherNo() + " 附件金额不一致（允许尾差 0.05 元）");
        }
    }

    private void verifySourceHash(SourceDocument document, Path file) {
        if (!hasText(document.getContentHash())) { return; }
        try {
            if (!MessageDigest.isEqual(sha256(file).getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                    document.getContentHash().getBytes(java.nio.charset.StandardCharsets.US_ASCII))) {
                throw new ApiException(409, "单据 " + document.getId() + " 影像哈希与采集记录不一致，禁止归档");
            }
        } catch (IOException exception) { throw new ApiException(422, "无法核验原始单据影像"); }
    }

    private Path requiredFile(String url, String label) {
        if (url == null || url.isBlank()) { throw new ApiException(422, label + " 缺少影像，不能生成档案"); }
        Path file = storage.resolve(url);
        if (!Files.isRegularFile(file) || !Files.isReadable(file)) { throw new ApiException(422, label + " 影像文件不存在"); }
        return file;
    }

    /** PDF 原页无损导入；PNG/JPEG 按比例居中放入 A4。最终顺序与 inputs 完全一致。 */
    public static void merge(List<Path> inputs, Path output) throws IOException {
        if (inputs.isEmpty()) { throw new ApiException(422, "没有可合并的影像"); }
        try (PDDocument result = new PDDocument()) {
            for (Path input : inputs) {
                if (input.getFileName().toString().toLowerCase(java.util.Locale.ROOT).endsWith(".pdf")) {
                    try (PDDocument source = Loader.loadPDF(input.toFile())) {
                        if (source.isEncrypted() || source.getNumberOfPages() == 0) { throw new ApiException(422, "加密或空白 PDF 不能直接归档"); }
                        if (result.getNumberOfPages() + source.getNumberOfPages() > MAX_PAGES) {
                            throw new ApiException(422, "单册超过 5000 页，请缩小凭证范围");
                        }
                        // appendDocument 深拷贝资源，源 PDF 关闭后字体/图片流仍然可用。
                        new PDFMergerUtility().appendDocument(result, source);
                    }
                } else {
                    PDImageXObject image = PDImageXObject.createFromFileByContent(input.toFile(), result);
                    if (image.getWidth() <= 0 || image.getHeight() <= 0 || (long) image.getWidth() * image.getHeight() > 80_000_000L) {
                        throw new ApiException(422, "影像尺寸无效或超过 8000 万像素");
                    }
                    if (result.getNumberOfPages() >= MAX_PAGES) { throw new ApiException(422, "单册超过 5000 页"); }
                    PDPage page = new PDPage(PDRectangle.A4); result.addPage(page);
                    float margin = 24, width = page.getMediaBox().getWidth() - 2 * margin, height = page.getMediaBox().getHeight() - 2 * margin;
                    float scale = Math.min(width / image.getWidth(), height / image.getHeight());
                    float renderedWidth = image.getWidth() * scale, renderedHeight = image.getHeight() * scale;
                    try (PDPageContentStream stream = new PDPageContentStream(result, page)) {
                        stream.drawImage(image, (page.getMediaBox().getWidth() - renderedWidth) / 2,
                                (page.getMediaBox().getHeight() - renderedHeight) / 2, renderedWidth, renderedHeight);
                    }
                }
            }
            result.save(output.toFile());
        }
    }

    public static String sha256(Path file) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = new DigestInputStream(Files.newInputStream(file), digest)) { input.transferTo(java.io.OutputStream.nullOutputStream()); }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException("JVM 不支持 SHA-256", exception); }
    }

    private int documentOrder(String type) {
        return switch (Objects.toString(type, "")) { case "INVOICE" -> 1; case "BANK_RECEIPT" -> 2; case "CONTRACT" -> 3; case "APPROVAL" -> 4; default -> 5; };
    }

    private VoucherNumber number(String value) {
        Matcher matcher = NUMBER.matcher(Objects.toString(value, ""));
        if (!matcher.matches()) { throw new ApiException(400, "凭证号必须以数字序号结尾"); }
        try { return new VoucherNumber(matcher.group(1), Integer.parseInt(matcher.group(2))); }
        catch (NumberFormatException exception) { throw new ApiException(400, "凭证序号超出范围"); }
    }

    private record VoucherNumber(String prefix, int sequence) { }
}
