package com.renderdeck.controller;

import com.renderdeck.entity.PropAsset;
import com.renderdeck.service.PropAssetService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{projectId}/props")
@RequiredArgsConstructor
public class PropAssetController {

    private final PropAssetService propAssetService;

    @GetMapping
    public List<PropAsset> list(@AuthenticationPrincipal Jwt jwt,
                                 @PathVariable UUID projectId) {
        return propAssetService.getPropsForProject(projectId, UUID.fromString(jwt.getSubject()));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public PropAsset upload(@AuthenticationPrincipal Jwt jwt,
                             @PathVariable UUID projectId,
                             @RequestParam("name") String name,
                             @RequestPart("file") MultipartFile file) throws IOException {
        return propAssetService.upload(UUID.fromString(jwt.getSubject()), projectId, name, file);
    }

    @DeleteMapping("/{propAssetId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt,
                        @PathVariable UUID propAssetId) {
        propAssetService.delete(propAssetId, UUID.fromString(jwt.getSubject()));
    }
}
