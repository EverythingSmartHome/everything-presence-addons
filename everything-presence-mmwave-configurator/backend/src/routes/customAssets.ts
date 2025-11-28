import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../config/storage';
import { CustomFloorMaterial, CustomFurnitureType } from '../domain/types';

export const createCustomAssetsRouter = (): Router => {
  const router = Router();

  // ==================== CUSTOM FLOOR MATERIALS ====================

  // List all custom floor materials
  router.get('/floors', (_req, res) => {
    const floors = storage.listCustomFloors();
    res.json({ floors });
  });

  // Create a new custom floor material
  router.post('/floors', (req, res) => {
    const body = req.body;

    // Validate required fields
    if (!body.label || typeof body.label !== 'string') {
      return res.status(400).json({ error: 'label is required' });
    }
    if (!body.color || typeof body.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      return res.status(400).json({ error: 'color must be a valid hex color (e.g., #FF0000)' });
    }

    const validCategories = ['wood', 'carpet', 'hard', 'other'];
    const validPatterns = ['solid', 'stripes', 'checker', 'dots'];

    const floor: CustomFloorMaterial = {
      id: `custom-${uuidv4().slice(0, 8)}`,
      label: body.label.trim(),
      emoji: typeof body.emoji === 'string' && body.emoji.trim() ? body.emoji.trim() : '🎨',
      color: body.color,
      category: validCategories.includes(body.category) ? body.category : 'other',
      patternType: validPatterns.includes(body.patternType) ? body.patternType : 'solid',
      createdAt: Date.now(),
    };

    storage.saveCustomFloor(floor);
    res.status(201).json({ floor });
  });

  // Update a custom floor material
  router.put('/floors/:id', (req, res) => {
    const { id } = req.params;
    const existing = storage.getCustomFloor(id);

    if (!existing) {
      return res.status(404).json({ error: 'Custom floor not found' });
    }

    const body = req.body;
    const validCategories = ['wood', 'carpet', 'hard', 'other'];
    const validPatterns = ['solid', 'stripes', 'checker', 'dots'];

    const updated: CustomFloorMaterial = {
      ...existing,
      label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : existing.label,
      emoji: typeof body.emoji === 'string' && body.emoji.trim() ? body.emoji.trim() : existing.emoji,
      color: typeof body.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(body.color) ? body.color : existing.color,
      category: validCategories.includes(body.category) ? body.category : existing.category,
      patternType: validPatterns.includes(body.patternType) ? body.patternType : existing.patternType,
    };

    storage.saveCustomFloor(updated);
    res.json({ floor: updated });
  });

  // Delete a custom floor material
  router.delete('/floors/:id', (req, res) => {
    const { id } = req.params;
    const deleted = storage.deleteCustomFloor(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Custom floor not found' });
    }

    res.json({ success: true });
  });

  // ==================== CUSTOM FURNITURE TYPES ====================

  // List all custom furniture types
  router.get('/furniture', (_req, res) => {
    const furniture = storage.listCustomFurniture();
    res.json({ furniture });
  });

  // Create a new custom furniture type
  router.post('/furniture', (req, res) => {
    const body = req.body;

    // Validate required fields
    if (!body.label || typeof body.label !== 'string') {
      return res.status(400).json({ error: 'label is required' });
    }
    if (!body.color || typeof body.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      return res.status(400).json({ error: 'color must be a valid hex color (e.g., #FF0000)' });
    }

    const validCategories = ['bedroom', 'living-room', 'office', 'dining', 'all'];
    const validShapes = ['rectangle', 'rounded', 'circle', 'lshaped'];

    const furniture: CustomFurnitureType = {
      id: `custom-${uuidv4().slice(0, 8)}`,
      label: body.label.trim(),
      category: validCategories.includes(body.category) ? body.category : 'all',
      defaultWidth: Number(body.defaultWidth) || 1000,
      defaultDepth: Number(body.defaultDepth) || 1000,
      defaultHeight: Number(body.defaultHeight) || 500,
      color: body.color,
      shape: validShapes.includes(body.shape) ? body.shape : 'rectangle',
      createdAt: Date.now(),
    };

    storage.saveCustomFurniture(furniture);
    res.status(201).json({ furniture });
  });

  // Update a custom furniture type
  router.put('/furniture/:id', (req, res) => {
    const { id } = req.params;
    const existing = storage.getCustomFurniture(id);

    if (!existing) {
      return res.status(404).json({ error: 'Custom furniture not found' });
    }

    const body = req.body;
    const validCategories = ['bedroom', 'living-room', 'office', 'dining', 'all'];
    const validShapes = ['rectangle', 'rounded', 'circle', 'lshaped'];

    const updated: CustomFurnitureType = {
      ...existing,
      label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : existing.label,
      category: validCategories.includes(body.category) ? body.category : existing.category,
      defaultWidth: Number(body.defaultWidth) || existing.defaultWidth,
      defaultDepth: Number(body.defaultDepth) || existing.defaultDepth,
      defaultHeight: Number(body.defaultHeight) || existing.defaultHeight,
      color: typeof body.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(body.color) ? body.color : existing.color,
      shape: validShapes.includes(body.shape) ? body.shape : existing.shape,
    };

    storage.saveCustomFurniture(updated);
    res.json({ furniture: updated });
  });

  // Delete a custom furniture type
  router.delete('/furniture/:id', (req, res) => {
    const { id } = req.params;
    const deleted = storage.deleteCustomFurniture(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Custom furniture not found' });
    }

    res.json({ success: true });
  });

  return router;
};
