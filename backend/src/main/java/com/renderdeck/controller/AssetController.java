package com.renderdeck.controller;

import com.renderdeck.entity.Asset;
import com.renderdeck.service.AssetService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/assets")
@RequiredArgsConstructor
public class AssetController {

    private final AssetService assetService;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Asset upload(@AuthenticationPrincipal Jwt jwt,
                         @RequestParam(value = "projectId", required = false) UUID projectId,
                         @RequestPart("file") MultipartFile file) throws IOException {
        return assetService.upload(UUID.fromString(jwt.getSubject()), projectId, file);
    }

    @GetMapping("/{assetId}/signed-url")
    public Map<String, String> getSignedUrl(@AuthenticationPrincipal Jwt jwt,
                                             @PathVariable UUID assetId) {
        String url = assetService.getSignedUrl(assetId, UUID.fromString(jwt.getSubject()));
        return Map.of("url", url);
    }

    @DeleteMapping("/{assetId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID assetId) {
        assetService.delete(assetId, UUID.fromString(jwt.getSubject()));
    }
}
