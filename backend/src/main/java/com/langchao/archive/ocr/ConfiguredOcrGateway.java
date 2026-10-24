package com.langchao.archive.ocr;

import com.langchao.archive.api.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import java.nio.file.Path;

/** 对接自建PaddleOCR HTTP网关的示例，云厂商可另实现OcrGateway并替换此Bean。 */
@Component
public class ConfiguredOcrGateway implements OcrGateway {
    private final String provider,endpoint,apiKey;
    public ConfiguredOcrGateway(@Value("${archive.ocr.provider:disabled}") String provider,
        @Value("${archive.ocr.endpoint:}") String endpoint,@Value("${archive.ocr.api-key:}") String apiKey) {
        this.provider=provider;this.endpoint=endpoint;this.apiKey=apiKey;
    }
    @Override public Result recognize(Path file) {
        if(!"paddle-http".equals(provider)||endpoint.isBlank()) throw new ApiException(503,"尚未配置OCR服务，请配置paddle-http网关或实现云厂商适配器");
        try {
            var body=new LinkedMultiValueMap<String,Object>();body.add("file",new FileSystemResource(file));
            Result result=RestClient.builder().build().post().uri(endpoint)
                .header("Authorization","Bearer "+apiKey).contentType(MediaType.MULTIPART_FORM_DATA).body(body).retrieve().body(Result.class);
            if(result==null||result.amount()==null||result.date()==null) throw new ApiException(422,"OCR未识别出有效金额或日期，请人工校正后重试");
            return result;
        } catch(ApiException e) {throw e;} catch(RuntimeException e) {throw new ApiException(502,"OCR上游调用失败，请检查网关配置");}
    }
}
