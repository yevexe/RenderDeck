package com.renderdeck.service;

import com.renderdeck.entity.Scene;
import com.renderdeck.repository.SceneRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class SceneService {

    private final SceneRepository sceneRepository;

    public List<Scene> getScenesForProject(UUID projectId) {
        return sceneRepository.findByProjectId(projectId);
    }

    public Scene getScene(UUID sceneId) {
        return sceneRepository.findById(sceneId)
                .orElseThrow(() -> new RuntimeException("Scene not found"));
    }

    @Transactional
    public Scene save(UUID projectId, UUID sceneId, String name, Map<String, Object> sceneData) {
        Scene scene = sceneId != null ? sceneRepository.findById(sceneId).orElse(new Scene()) : new Scene();
        scene.setProjectId(projectId);
        scene.setName(name);
        scene.setSceneData(sceneData);
        return sceneRepository.save(scene);
    }

    @Transactional
    public void delete(UUID sceneId) {
        sceneRepository.deleteById(sceneId);
    }
}
