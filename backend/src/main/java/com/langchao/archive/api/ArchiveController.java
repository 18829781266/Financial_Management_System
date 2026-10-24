package com.langchao.archive.api;

import com.langchao.archive.service.*;
import com.langchao.archive.storage.FileStorage;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.math.BigDecimal;
import java.security.Principal;
import java.util.Map;

/** Controller仅处理HTTP和参数校验，事务与规则全部交给Service层。 */
@RestController
@RequestMapping("/api/v1")
@Validated
public class ArchiveController {
    private final DataService data;
    private final MatchService matches;
    private final ArchiveService archive;
    private final PeriodLock lock;
    private final FileStorage files;
    public ArchiveController(DataService data,MatchService matches,ArchiveService archive,PeriodLock lock,FileStorage files) {
        this.data=data;this.matches=matches;this.archive=archive;this.lock=lock;this.files=files;
    }
    @PostMapping("/vouchers/import")
    public ApiResponse<?> importVouchers(@RequestBody @Valid ApiModels.ImportRequest request,Principal principal) {
        return ApiResponse.ok(data.importVouchers(request,actor(principal)));
    }
    @PostMapping(value="/documents/ocr",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<?> ocr(@RequestPart("file") MultipartFile file,
        @RequestParam @Pattern(regexp="\\d{4}-(0[1-9]|1[0-2])") String period,Principal principal) {
        return ApiResponse.ok(data.recognize(file,period,actor(principal)));
    }
    @PostMapping(value="/files",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<?> upload(@RequestPart("file") MultipartFile file) {return ApiResponse.ok(Map.of("imageUrl",files.store(file)));}
    @GetMapping("/files/{fileName}")
    public ResponseEntity<Resource> file(@PathVariable String fileName) {
        MediaType type=fileName.endsWith(".pdf")?MediaType.APPLICATION_PDF:fileName.endsWith(".png")?MediaType.IMAGE_PNG:MediaType.IMAGE_JPEG;
        return ResponseEntity.ok().contentType(type).header("X-Content-Type-Options","nosniff")
            .header(HttpHeaders.CACHE_CONTROL,"private, no-store").body(archive.file("/files/"+fileName));
    }
    @PostMapping("/match/auto")
    public ApiResponse<?> auto(@RequestBody @Valid ApiModels.AutoRequest request,Principal principal) {
        return ApiResponse.ok(matches.auto(request.period(),actor(principal)));
    }
    @GetMapping("/match/exceptions")
    public ApiResponse<?> exceptions(@RequestParam(required=false) String period,
        @RequestParam(defaultValue="1") @Min(1) long page,@RequestParam(defaultValue="20") @Min(1) @Max(100) long size) {
        return ApiResponse.ok(matches.exceptions(period,page,size));
    }
    @PostMapping("/match/manual")
    public ApiResponse<?> manual(@RequestBody @Valid ApiModels.ManualRequest request,Principal principal) {
        return ApiResponse.ok(matches.manual(request,actor(principal)));
    }
    @GetMapping("/match/recommendations")
    public ApiResponse<?> recommendations(@RequestParam @Positive long voucherId) {return ApiResponse.ok(matches.recommendations(voucherId));}
    @PostMapping("/vouchers/{id}/missing")
    public ApiResponse<?> missing(@PathVariable @Positive long id,@RequestBody @Valid ApiModels.MissingRequest request,Principal principal) {
        matches.missing(id,request.reason(),actor(principal));return ApiResponse.ok(Map.of("id",id,"status","MISSING"));
    }
    @PostMapping("/archive/generate")
    public ApiResponse<?> generate(@RequestBody @Valid ApiModels.GenerateRequest request,Principal principal) {
        return ApiResponse.ok(lock.execute(request.period(),()->archive.generate(request.period(),request.startVoucherNo(),request.endVoucherNo(),actor(principal))));
    }
    @GetMapping("/archive/search")
    public ApiResponse<?> search(@RequestParam(required=false) String period,@RequestParam(required=false) String voucherNo,
        @RequestParam(required=false) String invoiceNo,@RequestParam(required=false) String contractNo,
        @RequestParam(required=false) String supplierName,@RequestParam(required=false) String keyword,
        @RequestParam(required=false) @DecimalMin("0") BigDecimal minAmount,@RequestParam(required=false) @DecimalMin("0") BigDecimal maxAmount,
        @RequestParam(defaultValue="1") @Min(1) long page,@RequestParam(defaultValue="20") @Min(1) @Max(100) long size) {
        if(minAmount!=null&&maxAmount!=null&&minAmount.compareTo(maxAmount)>0)throw new ApiException(400,"金额下限不能大于上限");
        return ApiResponse.ok(archive.search(period,voucherNo,invoiceNo,contractNo,supplierName,keyword,minAmount,maxAmount,page,size));
    }
    @GetMapping("/archive/{id}/pdf")
    public ResponseEntity<Resource> pdf(@PathVariable @Positive long id) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF).header(HttpHeaders.CONTENT_DISPOSITION,"inline; filename=archive-"+id+".pdf")
            .header(HttpHeaders.CACHE_CONTROL,"private, no-store").body(archive.pdf(id));
    }
    @GetMapping("/vouchers")
    public ApiResponse<?> vouchers(@RequestParam(required=false) String period,@RequestParam(required=false) String keyword,@RequestParam(required=false) String status,
        @RequestParam(defaultValue="1") @Min(1) long page,@RequestParam(defaultValue="20") @Min(1) @Max(100) long size) {
        return ApiResponse.ok(data.listVouchers(period,keyword,status,page,size));
    }
    @GetMapping("/documents")
    public ApiResponse<?> documents(@RequestParam(required=false) String period,@RequestParam(required=false) String keyword,@RequestParam(required=false) String status,
        @RequestParam(defaultValue="1") @Min(1) long page,@RequestParam(defaultValue="20") @Min(1) @Max(100) long size) {
        return ApiResponse.ok(data.listDocuments(period,keyword,status,page,size));
    }
    @GetMapping("/relations/{relationId}/chain")
    public ApiResponse<?> chain(@PathVariable @Pattern(regexp="[0-9a-fA-F-]{36}") String relationId) {return ApiResponse.ok(matches.chain(relationId));}
    @GetMapping("/rules")
    public ApiResponse<?> rules() {return ApiResponse.ok(matches.loadRules());}
    @PutMapping("/rules/{ruleId}")
    public ApiResponse<?> updateRule(@PathVariable @Pattern(regexp="R0[1-7]") String ruleId,@RequestBody @Valid ApiModels.RuleUpdate request,Principal principal) {
        return ApiResponse.ok(matches.updateRule(ruleId,request,actor(principal)));
    }
    private String actor(Principal principal) {return principal==null?"local-operator":principal.getName();}
}
