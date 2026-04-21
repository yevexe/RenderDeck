package com.renderdeck.controller;

import com.renderdeck.entity.Material;
import com.renderdeck.entity.MaterialChannelMap;
import com.renderdeck.service.MaterialService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{projectId}/materials")
@RequiredArgsConstructor
public class MaterialController {

    private final MaterialService materialService;

    @GetMapping
    public List<Material> list(@AuthenticationPrincipal Jwt jwt,
                                @PathVariable UUID projectId) {
        return materialService.getMaterialsForProject(projectId, UUID.fromString(jwt.getSubject()));
    }

    @PutMapping("/{materialId}")
    public Material upsert(@AuthenticationPrincipal Jwt jwt,
                            @PathVariable UUID projectId,
                            @PathVariable UUID materialId,
                            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        Map<String, Object> values = (Map<String, Object>) body.get("materialValues");
        return materialService.upsert(materialId, UUID.fromString(jwt.getSubject()),
                projectId, (String) body.get("name"), values);
    }

    @DeleteMapping("/{materialId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt,
                        @PathVariable UUID materialId) {
        materialService.deleteMaterial(materialId, UUID.fromString(jwt.getSubject()));
    }

    @GetMapping("/{materialId}/channel-maps")
    public List<MaterialChannelMap> getChannelMaps(@AuthenticationPrincipal Jwt jwt,
                                                    @PathVariable UUID materialId) {
        return materialService.getChannelMaps(materialId, UUID.fromString(jwt.getSubject()));
    }

    @PutMapping("/{materialId}/channel-maps/{channel}")
    public MaterialChannelMap upsertChannelMap(@AuthenticationPrincipal Jwt jwt,
                                                @PathVariable UUID materialId,
                                                @PathVariable String channel,
                                                @RequestPart("file") MultipartFile file) throws IOException {
        return materialService.upsertChannelMap(materialId, channel,
                UUID.fromString(jwt.getSubject()), file);
    }

    @DeleteMapping("/{materialId}/channel-maps/{channelMapId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteChannelMap(@AuthenticationPrincipal Jwt jwt,
                                  @PathVariable UUID channelMapId) {
        materialService.deleteChannelMap(channelMapId, UUID.fromString(jwt.getSubject()));
    }
}
