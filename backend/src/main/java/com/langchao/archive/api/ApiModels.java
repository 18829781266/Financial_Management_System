package com.langchao.archive.api;

import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** HTTP边界DTO；不直接接受数据库实体，避免客户端越权写入状态和置信分。 */
public final class ApiModels {
    private ApiModels() { }
    public record Entry(@NotBlank String accountCode, @NotBlank String accountName,
        @Pattern(regexp="DEBIT|CREDIT") @NotNull String direction, @NotNull @DecimalMin("0.00") @Digits(integer=17,fraction=2) BigDecimal amount) { }
    public record VoucherInput(@NotBlank @Size(max=128) String externalId,
        @NotBlank @Size(max=64) @JsonAlias("VoucherNo") String voucherNo,
        @NotBlank @Pattern(regexp="\\d{4}-(0[1-9]|1[0-2])") @JsonAlias("Period") String period,
        @Size(max=1000) @JsonAlias("Abstract") String summary,
        @NotNull @DecimalMin("0.01") @Digits(integer=17,fraction=2) BigDecimal amount,
        @NotNull LocalDate voucherDate, @Size(max=255) @JsonAlias("SupplierName") String supplierName,
        String invoiceNo, String contractNo, String bankFlowNo, String approvalNo,
        @JsonAlias("CustomFields") Map<String,Object> customFields,
        @NotBlank String imageUrl, @NotNull @Min(1) @Max(500) Integer expectedAttachmentCount,
        @NotEmpty @Size(max=1000) @Valid @JsonAlias("Entries") List<Entry> entries) { }
    public record ImportRequest(@NotBlank @Size(max=32) String sourceSystem, @NotBlank String batchId,
        @NotEmpty @Size(max=1000) @Valid List<VoucherInput> vouchers) { }
    public record AutoRequest(@NotBlank @Pattern(regexp="\\d{4}-(0[1-9]|1[0-2])") String period) { }
    public record ManualRequest(@NotNull @Positive Long voucherId, @NotEmpty @Size(max=500) List<@Positive Long> documentIds,
        @NotBlank @Size(max=1000) String reason) { }
    public record MissingRequest(@NotBlank @Size(max=1000) String reason) { }
    public record GenerateRequest(@NotBlank @Pattern(regexp="\\d{4}-(0[1-9]|1[0-2])") String period,
        @NotBlank String startVoucherNo, @NotBlank String endVoucherNo) { }
    public record RuleUpdate(@NotNull @DecimalMin("0") @DecimalMax("1") BigDecimal threshold,
        @NotNull Map<String,Object> conditions, @NotNull Boolean enabled, @NotNull @Min(0) Integer version) { }
}
