package com.langchao.archive.ocr;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.Map;

/** PaddleOCR/阿里云/腾讯云适配口：提供商SDK需将原始响应映射到本结果，禁止伪造OCR字段。 */
public interface OcrGateway {
    record Result(String docType,String amount,String date,String supplierName,String invoiceNo,
        String contractNo,String bankFlowNo,String approvalNo,Boolean sealPresent,BigDecimal confidence,
        Map<String,Object> rawFields) { }
    Result recognize(Path file);
}
