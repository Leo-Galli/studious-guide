import * as THREE from '/vendor/three/build/three.module.js'
import { VRButton } from '/vendor/three/examples/jsm/webxr/VRButton.js'

const DEFAULTS = {
  background: 0x0b0f14,
  floor: 0x121820,
  gridMajor: 0x2c3642,
  gridMinor: 0x182028,
  flySpeed: 0.06,
  turnSpeed: 0.05,
  desktopSpeed: 0.1,
  eyeHeight: 1.6,
  cameraZ: 3.6
}

/**
 * Shared WebXR shell for Metaverso a Scuola.
 * Desktop: WASD / arrows move, QE up-down, R reset.
 * VR: left stick move, right stick turn + vertical.
 */
export const createXrShell = (options = {}) => {
  const cfg = { ...DEFAULTS, ...options }

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local')
  document.body.appendChild(renderer.domElement)
  document.body.appendChild(VRButton.createButton(renderer))

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(cfg.background)

  const cameraRig = new THREE.Group()
  scene.add(cameraRig)

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 140)
  camera.position.set(0, cfg.eyeHeight, cfg.cameraZ)
  cameraRig.add(camera)

  scene.add(new THREE.HemisphereLight(0xe6eee8, 0x151a20, 1))
  const key = new THREE.DirectionalLight(0xffffff, 0.8)
  key.position.set(5, 9, 4)
  scene.add(key)

  if (cfg.withFloor !== false) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 32),
      new THREE.MeshStandardMaterial({ color: cfg.floor, roughness: 0.95, metalness: 0.04 })
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)
    const grid = new THREE.GridHelper(32, 64, cfg.gridMajor, cfg.gridMinor)
    grid.position.y = 0.01
    scene.add(grid)
  }

  const controllers = [0, 1].map((i) => {
    const controller = renderer.xr.getController(i)
    cameraRig.add(controller)
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xc8f542, transparent: true, opacity: 0.65 })
    )
    ray.name = 'laser'
    ray.scale.z = 8
    controller.add(ray)
    return controller
  })

  const keys = Object.create(null)
  window.addEventListener('keydown', (e) => { keys[e.code] = true })
  window.addEventListener('keyup', (e) => { keys[e.code] = false })

  let yaw = 0
  const forward = new THREE.Vector3()
  const right = new THREE.Vector3()
  const defaultCam = new THREE.Vector3(0, cfg.eyeHeight, cfg.cameraZ)

  const resetView = () => {
    cameraRig.position.set(0, 0, 0)
    cameraRig.rotation.set(0, 0, 0)
    yaw = 0
    camera.position.copy(defaultCam)
    camera.rotation.set(0, 0, 0)
  }

  const headingVectors = () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    forward.set(0, 0, -1).applyQuaternion(q)
    right.set(1, 0, 0).applyQuaternion(q)
  }

  const processDesktop = () => {
    if (renderer.xr.isPresenting) return
    const speed = cfg.desktopSpeed
    headingVectors()
    if (keys.KeyW || keys.ArrowUp) cameraRig.position.addScaledVector(forward, speed)
    if (keys.KeyS || keys.ArrowDown) cameraRig.position.addScaledVector(forward, -speed)
    if (keys.KeyA || keys.ArrowLeft) cameraRig.position.addScaledVector(right, -speed)
    if (keys.KeyD || keys.ArrowRight) cameraRig.position.addScaledVector(right, speed)
    if (keys.KeyQ || keys.PageDown) cameraRig.position.y -= speed
    if (keys.KeyE || keys.PageUp) cameraRig.position.y += speed
    if (keys.KeyR) resetView()
  }

  const processGamepad = () => {
    const session = renderer.xr.getSession()
    if (!session) return
    headingVectors()
    for (const source of session.inputSources) {
      const pad = source.gamepad
      if (!pad || !pad.axes || pad.axes.length < 4) continue
      const sx = pad.axes[2]
      const sy = pad.axes[3]
      if (source.handedness === 'left') {
        if (Math.abs(sx) > 0.12) cameraRig.position.addScaledVector(right, sx * cfg.flySpeed)
        if (Math.abs(sy) > 0.12) cameraRig.position.addScaledVector(forward, -sy * cfg.flySpeed)
      } else {
        if (Math.abs(sx) > 0.3) {
          yaw -= sx * cfg.turnSpeed
          cameraRig.rotation.y = yaw
        }
        if (Math.abs(sy) > 0.12) cameraRig.position.y -= sy * cfg.flySpeed
      }
    }
  }

  const setLaserColor = (controller, hex) => {
    const laser = controller.getObjectByName('laser')
    if (laser && laser.material) laser.material.color.setHex(hex)
  }

  const attachDrag = (targets, {
    onHit = null,
    activeColor = 0x7dffb0,
    idleColor = 0xc8f542
  } = {}) => {
    const list = (Array.isArray(targets) ? targets : [targets]).filter(Boolean)
    const raycaster = new THREE.Raycaster()
    const tempMatrix = new THREE.Matrix4()
    let selected = null
    let mode = null
    const startPos = new THREE.Vector3()
    const objStart = new THREE.Vector3()
    const startQuat = new THREE.Quaternion()
    const objQuat = new THREE.Quaternion()

    const getHits = (controller) => {
      tempMatrix.identity().extractRotation(controller.matrixWorld)
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix)
      return list.flatMap((obj) => raycaster.intersectObject(obj, true))
    }

    const onStart = (event) => {
      const controller = event.target
      const hits = getHits(controller)
      if (!hits.length) return
      const hit = hits[0]
      if (onHit) {
        const custom = onHit(hit, controller)
        if (custom === false) return
        if (custom && custom.mode) {
          mode = custom.mode
          selected = controller
          return
        }
      }
      let root = hit.object
      while (root.parent && !list.includes(root)) root = root.parent
      if (!list.includes(root)) root = hit.object
      mode = 'transform'
      selected = controller
      startPos.setFromMatrixPosition(controller.matrixWorld)
      objStart.copy(root.position)
      startQuat.copy(controller.quaternion)
      objQuat.copy(root.quaternion)
      root.userData.__dragRoot = root
      controller.userData.__dragRoot = root
    }

    const onEnd = (event) => {
      if (selected === event.target) {
        selected = null
        mode = null
      }
      setLaserColor(event.target, idleColor)
    }

    controllers.forEach((c) => {
      c.addEventListener('selectstart', onStart)
      c.addEventListener('selectend', onEnd)
    })

    const updateDrag = () => {
      controllers.forEach((c) => {
        const hits = getHits(c)
        setLaserColor(c, hits.length ? activeColor : idleColor)
      })
      if (!selected || mode !== 'transform') return
      const root = selected.userData.__dragRoot
      if (!root) return
      const cur = new THREE.Vector3().setFromMatrixPosition(selected.matrixWorld)
      root.position.copy(objStart).add(cur.clone().sub(startPos))
      const delta = selected.quaternion.clone().multiply(startQuat.clone().invert())
      root.quaternion.copy(objQuat).premultiply(delta)
    }

    return { updateDrag, getSelected: () => selected, getMode: () => mode }
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  const startLoop = (onFrame) => {
    renderer.setAnimationLoop(() => {
      processDesktop()
      processGamepad()
      if (typeof onFrame === 'function') onFrame()
      renderer.render(scene, camera)
    })
  }

  const hideHudInVr = (els) => {
    const list = (Array.isArray(els) ? els : [els]).filter(Boolean)
    renderer.xr.addEventListener('sessionstart', () => list.forEach((el) => { el.style.display = 'none' }))
    renderer.xr.addEventListener('sessionend', () => list.forEach((el) => { el.style.display = '' }))
  }

  return {
    THREE,
    scene,
    camera,
    cameraRig,
    renderer,
    controllers,
    resetView,
    startLoop,
    setLaserColor,
    hideHudInVr,
    attachDrag,
    keys
  }
}

export const makeAxes = (THREE, {
  length = 2.6,
  thickness = 0.022,
  colors = [0x7ec8ff, 0x9dffa0, 0xff9db8]
} = {}) => {
  const group = new THREE.Group()
  const mats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.15 }))
  const cyl = new THREE.CylinderGeometry(thickness, thickness, length, 12)
  const cone = new THREE.ConeGeometry(0.06, 0.18, 14)

  const x = new THREE.Mesh(cyl, mats[0])
  x.rotation.z = -Math.PI / 2
  x.position.x = length / 2
  group.add(x)
  const xA = new THREE.Mesh(cone, mats[0])
  xA.rotation.z = -Math.PI / 2
  xA.position.set(length, 0, 0)
  group.add(xA)

  const y = new THREE.Mesh(cyl, mats[1])
  y.position.y = length / 2
  group.add(y)
  const yA = new THREE.Mesh(cone, mats[1])
  yA.position.set(0, length, 0)
  group.add(yA)

  const z = new THREE.Mesh(cyl, mats[2])
  z.rotation.x = Math.PI / 2
  z.position.z = length / 2
  group.add(z)
  const zA = new THREE.Mesh(cone, mats[2])
  zA.rotation.x = Math.PI / 2
  zA.position.set(0, 0, length)
  group.add(zA)

  return group
}

/** @deprecated kept for older imports; never appends modifiers */
export const creditLine = (original = '') => String(original || '').trim()

/**
 * Build a smooth plot curve as a TubeGeometry around a CatmullRomCurve3.
 * Pass a flat array of Vector3 for a single segment, or an array of
 * Vector3[] segments for curves with discontinuities (tan, a*x - b/x).
 * Returns a Group so callers can swap it in one move.
 */
export const makeTube = (THREE, segments, {
  radius = 0.03,
  color = 0xc8f542,
  tubularScale = 2
} = {}) => {
  const list = Array.isArray(segments[0]) ? segments : [segments]
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.3,
    metalness: 0.2,
    emissive: color,
    emissiveIntensity: 0.18
  })
  list.forEach((pts) => {
    if (!pts || pts.length < 2) return
    const curve = new THREE.CatmullRomCurve3(pts)
    const tubular = Math.max(16, Math.round(pts.length * tubularScale))
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, radius, 10, false), mat))
  })
  return group
}
