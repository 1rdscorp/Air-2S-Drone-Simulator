import { Color, DirectionalLight, type Fog, HemisphereLight, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { LightingProfile } from '../world/environment';
import { aimSunAt, applyLighting, createBaseScene, SUN_OFFSET } from './baseScene';

describe('createBaseScene', () => {
  it('contains a sun and a sky light, and nothing of any place yet', () => {
    const { scene, sun, skyLight } = createBaseScene();

    expect(scene.getObjectByName('sun')).toBe(sun);
    expect(sun).toBeInstanceOf(DirectionalLight);
    expect(scene.getObjectByName('sky-light')).toBe(skyLight);
    expect(skyLight).toBeInstanceOf(HemisphereLight);
    expect(scene.getObjectByName('ground')).toBeUndefined();
  });

  it('sets up the shadow area so that it really reaches from the light to the ground', () => {
    const { sun } = createBaseScene();
    const lightToGround = sun.position.distanceTo(sun.target.position);

    // The projection matrix must be the one for the configured range, not the built-in default.
    const expected = sun.shadow.camera.clone();
    expected.updateProjectionMatrix();
    expect(sun.shadow.camera.projectionMatrix.equals(expected.projectionMatrix)).toBe(true);
    expect(sun.shadow.camera.far).toBeGreaterThan(lightToGround);
    expect(sun.shadow.camera.near).toBeLessThan(lightToGround);
  });

  it('lets the sun cast shadows', () => {
    const { scene, sun } = createBaseScene();

    expect(sun.castShadow).toBe(true);
    expect(sun.target.parent).toBe(scene);
  });
});

describe('applyLighting', () => {
  const dusk: LightingProfile = {
    sky: [255, 128, 0],
    hazeStart: 50,
    hazeEnd: 900,
    sunColor: 0xff8844,
    sunStrength: 1.5,
    skyLightColor: 0x112233,
    groundLightColor: 0x332211,
    skyLightStrength: 0.4,
  };

  it('gives the stage the sky colour and haze of a place', () => {
    const base = createBaseScene();
    applyLighting(base, dusk);

    const background = base.scene.background as Color;
    const fog = base.scene.fog as Fog;
    expect(background.getHexString()).toBe('ff8000');
    expect(fog.color.getHexString()).toBe('ff8000');
    expect(fog.near).toBe(50);
    expect(fog.far).toBe(900);
  });

  it('sets the sun and the sky light', () => {
    const base = createBaseScene();
    applyLighting(base, dusk);

    expect(base.sun.color.getHex()).toBe(0xff8844);
    expect(base.sun.intensity).toBe(1.5);
    expect(base.skyLight.color.getHex()).toBe(0x112233);
    expect(base.skyLight.groundColor.getHex()).toBe(0x332211);
    expect(base.skyLight.intensity).toBe(0.4);
  });

  it('keeps the same sky and haze objects, so nothing has to be rebuilt', () => {
    const base = createBaseScene();
    const background = base.scene.background;
    const fog = base.scene.fog;
    applyLighting(base, dusk);

    expect(base.scene.background).toBe(background);
    expect(base.scene.fog).toBe(fog);
  });
});

describe('aimSunAt', () => {
  const direction = (sun: DirectionalLight): Vector3 =>
    sun.target.position.clone().sub(sun.position).normalize();

  it('always shines from the same direction', () => {
    const { sun } = createBaseScene();
    const atStart = direction(sun);

    aimSunAt(sun, 800, 120, -300);
    expect(direction(sun).distanceTo(atStart)).toBeLessThan(1e-9);

    aimSunAt(sun, -40, 900, 70, 650);
    expect(direction(sun).distanceTo(atStart)).toBeLessThan(1e-9);
  });

  it('aims straight below an aircraft that stands on the ground', () => {
    const { sun } = createBaseScene();
    aimSunAt(sun, 50, 0, -20);

    expect(sun.target.position.toArray()).toEqual([50, 0, -20]);
    expect(sun.position.toArray()).toEqual([50 + SUN_OFFSET.x, SUN_OFFSET.y, -20 + SUN_OFFSET.z]);
  });

  it('keeps a high aircraft exactly on the line between the light and its shadow spot', () => {
    const { sun } = createBaseScene();
    const aircraft = new Vector3(100, 150, 40);
    aimSunAt(sun, aircraft.x, aircraft.y, aircraft.z);

    const toAircraft = aircraft.clone().sub(sun.position).normalize();
    expect(toAircraft.distanceTo(direction(sun))).toBeLessThan(1e-9);
    expect(sun.target.position.y).toBe(0);
  });

  it('puts the shadow spot on the surface below the aircraft, wherever that is', () => {
    const { sun } = createBaseScene();
    // Standing on a roof 30 m up.
    aimSunAt(sun, 10, 30, 10, 30);
    expect(sun.target.position.toArray()).toEqual([10, 30, 10]);

    // 100 m above ground that lies at 400 m.
    const aircraft = new Vector3(0, 500, 0);
    aimSunAt(sun, aircraft.x, aircraft.y, aircraft.z, 400);
    expect(sun.target.position.y).toBe(400);
    const toAircraft = aircraft.clone().sub(sun.position).normalize();
    expect(toAircraft.distanceTo(direction(sun))).toBeLessThan(1e-9);
  });

  it('keeps the aircraft between the light and the ground up to 500 m', () => {
    const { sun } = createBaseScene();
    aimSunAt(sun, 0, 499, 0);

    expect(sun.position.y).toBeGreaterThan(499);
    const distance = sun.position.distanceTo(new Vector3(0, 499, 0));
    expect(distance).toBeGreaterThan(sun.shadow.camera.near);
    expect(sun.position.distanceTo(sun.target.position)).toBeLessThan(sun.shadow.camera.far);
  });
});
