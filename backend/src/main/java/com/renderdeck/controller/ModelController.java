package com.renderdeck.controller;

import com.renderdeck.entity.Decal;
import com.renderdeck.entity.Part;
import com.renderdeck.entity.ProductModel;
import com.renderdeck.service.ModelService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class ModelController {

    private final ModelService modelService;

    // ── Models ───────────────────────────────────────────────────────────────

    @GetMapping("/api/projects/{projectId}/models")
    public List<ProductModel> list(@AuthenticationPrincipal Jwt jwt,
                                    @PathVariable UUID projectId) {
        return modelService.getModelsForProject(projectId);
    }

    @PostMapping("/api/projects/{projectId}/models")
    @ResponseStatus(HttpStatus.CREATED)
    public ProductModel create(@AuthenticationPrincipal Jwt jwt,
                                @PathVariable UUID projectId,
                                @RequestBody Map<String, Object> body) {
        String name = (String) body.get("name");
        if (name == null || name.isBlank()) throw new IllegalArgumentException("Model name is required");
        UUID customModelAssetId = body.get("customModelAssetId") != null
                ? UUID.fromString((String) body.get("customModelAssetId")) : null;
        String sourceType = (String) body.getOrDefault("sourceType", "standard");
        return modelService.createModel(projectId, name, (String) body.get("baseModel"),
                customModelAssetId, sourceType);
    }

    @GetMapping("/api/models/{modelId}")
    public ProductModel get(@AuthenticationPrincipal Jwt jwt,
                             @PathVariable UUID modelId) {
        return modelService.getModel(modelId, uuid(jwt));
    }

    @PatchMapping("/api/models/{modelId}")
    public ProductModel update(@AuthenticationPrincipal Jwt jwt,
                                @PathVariable UUID modelId,
                                @RequestBody Map<String, Object> body) {
        UUID customModelAssetId = body.get("customModelAssetId") != null
                ? UUID.fromString((String) body.get("customModelAssetId")) : null;
        return modelService.updateModel(modelId, uuid(jwt),
                (String) body.get("name"), (String) body.get("baseModel"), customModelAssetId);
    }

    @DeleteMapping("/api/models/{modelId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt,
                        @PathVariable UUID modelId) {
        modelService.deleteModel(modelId, uuid(jwt));
    }

    // ── Parts ────────────────────────────────────────────────────────────────

    @GetMapping("/api/models/{modelId}/parts")
    public List<Part> getParts(@AuthenticationPrincipal Jwt jwt,
                                @PathVariable UUID modelId) {
        return modelService.getPartsForModel(modelId, uuid(jwt));
    }

    @PutMapping("/api/models/{modelId}/parts/{partId}")
    public Part upsertPart(@AuthenticationPrincipal Jwt jwt,
                            @PathVariable UUID modelId,
                            @PathVariable UUID partId,
                            @RequestBody Map<String, Object> body) {
        UUID materialId = body.get("materialId") != null
                ? UUID.fromString((String) body.get("materialId")) : null;
        @SuppressWarnings("unchecked")
        Map<String, Object> overrides = (Map<String, Object>) body.get("materialOverrides");
        return modelService.upsertPart(modelId, partId, (String) body.get("name"),
                materialId, overrides, uuid(jwt));
    }

    @DeleteMapping("/api/models/{modelId}/parts/{partId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deletePart(@AuthenticationPrincipal Jwt jwt,
                            @PathVariable UUID partId) {
        modelService.deletePart(partId, uuid(jwt));
    }

    // ── Decals ───────────────────────────────────────────────────────────────

    @GetMapping("/api/parts/{partId}/decals")
    public List<Decal> getDecals(@AuthenticationPrincipal Jwt jwt,
                                  @PathVariable UUID partId) {
        return modelService.getDecalsForPart(partId, uuid(jwt));
    }

    @PutMapping("/api/parts/{partId}/decals/{decalId}")
    public Decal upsertDecal(@AuthenticationPrincipal Jwt jwt,
                              @PathVariable UUID partId,
                              @PathVariable UUID decalId,
                              @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        Map<String, Object> textData = (Map<String, Object>) body.get("textData");
        return modelService.upsertDecal(
                partId, decalId,
                UUID.fromString((String) body.get("assetId")),
                toDouble(body.get("posX")),     toDouble(body.get("posY")),
                toDouble(body.getOrDefault("sizeW", 1.0)), toDouble(body.getOrDefault("sizeH", 1.0)),
                toDouble(body.getOrDefault("rotation", 0.0)),
                ((Number) body.get("layerOrder")).intValue(),
                (String) body.get("name"),
                (String) body.getOrDefault("type", "image"),
                textData,
                Boolean.TRUE.equals(body.get("flipH")),
                Boolean.TRUE.equals(body.get("flipV")),
                body.get("aspectRatio") != null ? toDouble(body.get("aspectRatio")) : null,
                uuid(jwt));
    }

    @DeleteMapping("/api/parts/{partId}/decals/{decalId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteDecal(@AuthenticationPrincipal Jwt jwt,
                             @PathVariable UUID decalId) {
        modelService.deleteDecal(decalId, uuid(jwt));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private UUID uuid(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }

    private double toDouble(Object val) {
        return val instanceof Number n ? n.doubleValue() : 0.0;
    }
}
