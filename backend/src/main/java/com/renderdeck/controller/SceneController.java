package com.renderdeck.controller;

import com.renderdeck.entity.Scene;
import com.renderdeck.service.SceneService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{projectId}/scenes")
@RequiredArgsConstructor
public class SceneController {

    private final SceneService sceneService;

    @GetMapping
    public List<Scene> list(@AuthenticationPrincipal Jwt jwt,
                             @PathVariable UUID projectId) {
        return sceneService.getScenesForProject(projectId, uuid(jwt));
    }

    @GetMapping("/{sceneId}")
    public Scene get(@AuthenticationPrincipal Jwt jwt,
                      @PathVariable UUID sceneId) {
        return sceneService.getScene(sceneId, uuid(jwt));
    }

    @PutMapping("/{sceneId}")
    public Scene upsert(@AuthenticationPrincipal Jwt jwt,
                         @PathVariable UUID projectId,
                         @PathVariable UUID sceneId,
                         @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        Map<String, Object> sceneData = (Map<String, Object>) body.get("sceneData");
        return sceneService.save(projectId, sceneId, uuid(jwt), (String) body.get("name"), sceneData);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Scene create(@AuthenticationPrincipal Jwt jwt,
                         @PathVariable UUID projectId,
                         @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        Map<String, Object> sceneData = (Map<String, Object>) body.get("sceneData");
        return sceneService.save(projectId, null, uuid(jwt), (String) body.get("name"), sceneData);
    }

    @DeleteMapping("/{sceneId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt,
                        @PathVariable UUID sceneId) {
        sceneService.delete(sceneId, uuid(jwt));
    }

    private UUID uuid(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
