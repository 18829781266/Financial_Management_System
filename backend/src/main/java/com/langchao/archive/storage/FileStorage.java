package com.langchao.archive.storage;

import com.langchao.archive.api.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/** 本地存储适配器。业务只保存内部文件标识；不直接下载外部 URL，避免 SSRF。 */
@Component
public class FileStorage {
    private static final long MAX_BYTES = 20L * 1024 * 1024;
    private static final Pattern INTERNAL_PATH = Pattern.compile("^/files/[0-9a-fA-F-]{36}\\.(pdf|png|jpg)$");
    private final Path root;

    public FileStorage(@Value("${archive.storage-root:./data}") String directory) {
        try {
            Path configured = Path.of(directory).toAbsolutePath().normalize();
            Files.createDirectories(configured);
            this.root = configured.toRealPath();
        } catch (IOException exception) {
            throw new IllegalStateException("无法初始化文件存储目录", exception);
        }
    }

    /** 文件名由服务器生成，并按文件头识别格式，不信任上传方文件名和 Content-Type。 */
    public String store(MultipartFile upload) {
        if (upload == null || upload.isEmpty() || upload.getSize() > MAX_BYTES) {
            throw new ApiException(400, "文件不能为空且必须小于 20MB");
        }
        Path temporary = null;
        try (InputStream input = upload.getInputStream()) {
            temporary = temporary();
            long copied;
            try (var output = Files.newOutputStream(temporary, StandardOpenOption.TRUNCATE_EXISTING)) {
                copied = input.transferTo(new java.io.FilterOutputStream(output) {
                    private long count;
                    @Override public void write(byte[] bytes, int offset, int length) throws IOException {
                        count += length;
                        if (count > MAX_BYTES) { throw new IOException("文件超过20MB限制"); }
                        out.write(bytes, offset, length);
                    }
                    @Override public void write(int value) throws IOException {
                        if (++count > MAX_BYTES) { throw new IOException("文件超过20MB限制"); }
                        out.write(value);
                    }
                });
            }
            if (copied == 0) { throw new ApiException(400, "文件为空"); }
            byte[] header;
            try (InputStream saved = Files.newInputStream(temporary)) { header = saved.readNBytes(8); }
            String extension = extension(header);
            return commit(temporary, extension);
        } catch (IOException exception) {
            throw new ApiException(400, "上传失败：文件不可读取或超过大小限制");
        } finally {
            if (temporary != null) {
                try { Files.deleteIfExists(temporary); } catch (IOException ignored) { /* 临时文件清理由运维兜底。 */ }
            }
        }
    }

    public Path temporary() throws IOException { return Files.createTempFile(root, "archive-", ".tmp"); }

    public String commit(Path temporary, String extension) throws IOException {
        if (!java.util.Set.of("pdf", "png", "jpg").contains(extension.toLowerCase(Locale.ROOT))) {
            throw new ApiException(400, "不支持的文件格式");
        }
        String url = "/files/" + UUID.randomUUID() + "." + extension;
        Path destination = resolve(url);
        // 临时文件与最终文件位于同一文件系统，原子发布避免读到未写完的档案册。
        try { Files.move(temporary, destination, StandardCopyOption.ATOMIC_MOVE); }
        catch (java.nio.file.AtomicMoveNotSupportedException exception) { Files.move(temporary, destination); }
        return url;
    }

    public Path resolve(String internalUrl) {
        if (internalUrl == null || !INTERNAL_PATH.matcher(internalUrl).matches()) {
            throw new ApiException(400, "文件路径必须是系统内部文件标识");
        }
        Path resolved = root.resolve(internalUrl.substring("/files/".length())).normalize();
        if (!resolved.startsWith(root) || Files.isSymbolicLink(resolved)) {
            throw new ApiException(400, "非法文件路径");
        }
        return resolved;
    }

    public Resource resource(String internalUrl) {
        Path file = resolve(internalUrl);
        if (!Files.isRegularFile(file) || !Files.isReadable(file)) { throw new ApiException(404, "影像文件不存在"); }
        try { return new UrlResource(file.toUri()); }
        catch (java.net.MalformedURLException exception) { throw new ApiException(500, "文件地址无效"); }
    }

    public void delete(String internalUrl) {
        try { Files.deleteIfExists(resolve(internalUrl)); }
        catch (IOException exception) { throw new ApiException(500, "清理文件失败"); }
    }

    private String extension(byte[] header) {
        if (header.length >= 5 && header[0] == '%' && header[1] == 'P' && header[2] == 'D'
                && header[3] == 'F' && header[4] == '-') { return "pdf"; }
        if (header.length >= 8 && (header[0] & 255) == 137 && header[1] == 'P' && header[2] == 'N'
                && header[3] == 'G' && header[4] == 13 && header[5] == 10 && header[6] == 26 && header[7] == 10) { return "png"; }
        if (header.length >= 3 && (header[0] & 255) == 255 && (header[1] & 255) == 216 && (header[2] & 255) == 255) { return "jpg"; }
        throw new ApiException(400, "仅接受 PDF、PNG、JPEG 影像");
    }
}
