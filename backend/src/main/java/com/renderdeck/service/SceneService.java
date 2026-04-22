package com.renderdeck.service;

import com.renderdeck.entity.Project;
import com.renderdeck.entity.Scene;
import com.renderdeck.exception.ForbiddenException;
import com.renderdeck.exception.NotFoundException;
import com.renderdeck.repository.ProjectRepository;
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
    private final ProjectRepository projectRepository;

    private void checkProjectOwnership(UUID projectId, UUID requestingUserId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new NotFoundException("Project not found"));
        if (!project.getUserId().equals(requestingUserId)) throw new ForbiddenException();
    }

    private Scene loadSceneOwnedBy(UUID sceneId, UUID requestingUserId) {
        Scene scene = sceneRepository.findById(sceneId)
                .orElseThrow(() -> new NotFoundException("Scene not found"));
        checkProjectOwnership(scene.getProjectId(), requestingUserId);
        return scene;
    }

    public List<Scene> getScenesForProject(UUID projectId, UUID requestingUserId) {
        checkProjectOwnership(projectId, requestingUserId);
        return sceneRepository.findByProjectId(projectId);
    }

    public Scene getScene(UUID sceneId, UUID requestingUserId) {
        return loadSceneOwnedBy(sceneId, requestingUserId);
    }

    @Transactional
    public Scene save(UUID projectId, UUID sceneId, UUID requestingUserId,
                      String name, Map<String, Object> sceneData) {
        checkProjectOwnership(projectId, requestingUserId);
        Scene scene;
        if (sceneId != null) {
            scene = sceneRepository.findById(sceneId).orElse(new Scene());
            // If the scene exists, it must belong to the same project the caller owns
            if (scene.getProjectId() != null && !scene.getProjectId().equals(projectId)) {
                throw new ForbiddenException();
            }
        } else {
            scene = new Scene();
        }
        scene.setProjectId(projectId);
        scene.setName(name);
        scene.setSceneData(sceneData);
        return sceneRepository.save(scene);
    }

    @Transactional
    public void delete(UUID sceneId, UUID requestingUserId) {
        Scene scene = loadSceneOwnedBy(sceneId, requestingUserId);
        sceneRepository.delete(scene);
    }
}
