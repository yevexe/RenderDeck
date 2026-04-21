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
@RequestMapping("/api/projects/{projectId}/model")
@RequiredArgsConstructor
public class ModelController {

    private final ModelService modelService;

    @GetMapping
    public ProductModel getModel(@PathVariable UUID projectId) {
        return modelService.getModelForProject(projectId);
    }

    @PutMapping
    public ProductModel upsertModel(@PathVariable UUID projectId,
                                     @RequestBody Map<String, Object> body) {
        UUID customModelAssetId = body.get("customModelAssetId") != null
                ? UUID.fromString((String) body.get("customModelAssetId")) : null;
        return modelService.upsertModel(projectId, (String) body.get("baseModel"), customModelAssetId);
    }

    @GetMapping("/parts")
    public List<Part> getParts(@PathVariable UUID projectId) {
        ProductModel model = modelService.getModelForProject(projectId);
        return modelService.getPartsForModel(model.getId());
    }

    @PutMapping("/parts/{partId}")
    public Part upsertPart(@PathVariable UUID projectId,
                            @PathVariable UUID partId,
                            @RequestBody Map<String, Object> body) {
        ProductModel model = modelService.getModelForProject(projectId);
        UUID materialId = body.get("materialId") != null
                ? UUID.fromString((String) body.get("materialId")) : null;
        return modelService.upsertPart(model.getId(), partId, (String) body.get("name"), materialId);
    }

    @DeleteMapping("/parts/{partId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deletePart(@PathVariable UUID partId) {
        modelService.deletePart(partId);
    }

    @GetMapping("/parts/{partId}/decals")
    public List<Decal> getDecals(@PathVariable UUID partId) {
        return modelService.getDecalsForPart(partId);
    }

    @PutMapping("/parts/{partId}/decals/{decalId}")
    public Decal upsertDecal(@PathVariable UUID partId,
                              @PathVariable UUID decalId,
                              @RequestBody Map<String, Object> body) {
        return modelService.upsertDecal(
                partId, decalId,
                UUID.fromString((String) body.get("assetId")),
                toDouble(body.get("posX")), toDouble(body.get("posY")),
                toDouble(body.getOrDefault("scaleX", 1.0)), toDouble(body.getOrDefault("scaleY", 1.0)),
                toDouble(body.getOrDefault("rotation", 0.0)),
                ((Number) body.get("layerOrder")).intValue());
    }

    @DeleteMapping("/parts/{partId}/decals/{decalId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteDecal(@PathVariable UUID decalId) {
        modelService.deleteDecal(decalId);
    }

    private double toDouble(Object val) {
        return val instanceof Number n ? n.doubleValue() : 0.0;
    }
}
