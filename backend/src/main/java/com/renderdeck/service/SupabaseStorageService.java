package com.renderdeck.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;

@Service
public class SupabaseStorageService {

    private final RestClient restClient;
    private final String bucket;
    // Held for prepending to signed-URL paths — Supabase returns just
    // "/object/sign/..." which would resolve against the frontend's origin
    // and 404. Need the full https://{ref}.supabase.co/storage/v1 prefix.
    private final String storageBaseUrl;

    public SupabaseStorageService(
            @Value("${supabase.url}") String supabaseUrl,
            @Value("${supabase.service-key}") String serviceKey,
            @Value("${supabase.storage.bucket}") String bucket) {
        this.bucket = bucket;
        this.storageBaseUrl = supabaseUrl + "/storage/v1";
        this.restClient = RestClient.builder()
                .baseUrl(this.storageBaseUrl)
                .defaultHeader("Authorization", "Bearer " + serviceKey)
                .defaultHeader("apikey", serviceKey)
                .build();
    }

    public String upload(String storagePath, MultipartFile file) throws IOException {
        MultipartBodyBuilder builder = new MultipartBodyBuilder();
        builder.part("file", new ByteArrayResource(file.getBytes()) {
            @Override public String getFilename() { return file.getOriginalFilename(); }
        }).contentType(MediaType.parseMediaType(
                file.getContentType() != null ? file.getContentType() : "application/octet-stream"));

        restClient.post()
                .uri("/object/" + bucket + "/" + storagePath)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(builder.build())
                .retrieve()
                .toBodilessEntity();

        return storagePath;
    }

    public void delete(String storagePath) {
        restClient.delete()
                .uri("/object/" + bucket + "/" + storagePath)
                .retrieve()
                .toBodilessEntity();
    }

    @SuppressWarnings("unchecked")
    public String getSignedUrl(String storagePath, int expiresInSeconds) {
        Map<String, Object> body = Map.of("expiresIn", expiresInSeconds);
        Map<String, Object> response = restClient.post()
                .uri("/object/sign/" + bucket + "/" + storagePath)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(Map.class);

        if (response == null || !response.containsKey("signedURL")) {
            throw new RuntimeException("Failed to get signed URL for: " + storagePath);
        }
        // Supabase returns a relative path like "/object/sign/bucket/...".
        // Prepend the storage base URL so the frontend's TextureLoader can
        // load it directly without resolving against its own origin.
        return storageBaseUrl + (String) response.get("signedURL");
    }
}
