package com.renderdeck.controller;

import com.renderdeck.entity.Scene;
import com.renderdeck.service.SceneService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
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
    public List<Scene> list(@PathVariable UUID projectId) {
        return sceneService.getScenesForProject(projectId);
    }

    @GetMapping("/{sceneId}")
    public Scene get(@PathVariable UUID sceneId) {
        return sceneService.getScene(sceneId);
    }

    @PutMapping("/{sceneId}")
    public Scene upsert(@PathVariable UUID projectId,
                         @PathVariable UUID sceneId,
                         @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        Map<String, Object> sceneData = (Map<String, Object>) body.get("sceneData");
        return sceneService.save(projectId, sceneId, (String) body.get("name"), sceneData);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Scene create(@PathVariable UUID projectId,
                         @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        Map<String, Object> sceneData = (Map<String, Object>) body.get("sceneData");
        return sceneService.save(projectId, null, (String) body.get("name"), sceneData);
    }

    @DeleteMapping("/{sceneId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID sceneId) {
        sceneService.delete(sceneId);
    }
}
