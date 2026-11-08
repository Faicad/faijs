const COLOR_YELLOW = '#F7D117'
const COLOR_BLACK = '#222222'
const COLOR_RED = '#E23A2E'

const body_ball = cad.sphere({ radius: 1 * MM, segments: 64 })
const body_scaled = cad.scale3d(body_ball, { factor: [26, 24, 28] })
const pikachu_body = cad.translate(body_scaled, { offset: [0 * MM, 0 * MM, 30 * MM] })
pikachu_body.setColor(COLOR_YELLOW)
pikachu_body.setName('身体')

const head_ball = cad.sphere({ radius: 1 * MM, segments: 64 })
const head_scaled = cad.scale3d(head_ball, { factor: [30, 28, 26] })
const pikachu_head = cad.translate(head_scaled, { offset: [0 * MM, 0 * MM, 78 * MM] })
pikachu_head.setColor(COLOR_YELLOW)
pikachu_head.setName('头')

// ===== 左耳：椭球在局部坐标下被 z=8 的平面分成两节，下部黄色、上部（尖端）黑色 =====
const ear_left_base_ball = cad.sphere({ radius: 1 * MM, segments: 64 })
const ear_left_base_ellipsoid = cad.scale3d(ear_left_base_ball, { factor: [7, 6, 20] })
const ear_left_base_cutter = cad.box(40 * MM, 40 * MM, 40 * MM, { at: [0 * MM, 0 * MM, 8 * MM] })
const ear_left_base_local = cad.subtract(ear_left_base_ellipsoid, ear_left_base_cutter)
const ear_left_base_rot = cad.rotate_euler(ear_left_base_local, { angles: [0 * DEGREE, -20 * DEGREE, 0 * DEGREE] })
const ear_left_base = cad.translate(ear_left_base_rot, { offset: [-16 * MM, 0 * MM, 108 * MM] })
ear_left_base.setColor(COLOR_YELLOW)
ear_left_base.setName('左耳下部')

const ear_left_tip_ball = cad.sphere({ radius: 1 * MM, segments: 64 })
const ear_left_tip_ellipsoid = cad.scale3d(ear_left_tip_ball, { factor: [7, 6, 20] })
const ear_left_tip_cutter = cad.box(40 * MM, 40 * MM, 40 * MM, { at: [0 * MM, 0 * MM, 8 * MM] })
const ear_left_tip_local = cad.intersect(ear_left_tip_ellipsoid, ear_left_tip_cutter)
const ear_left_tip_rot = cad.rotate_euler(ear_left_tip_local, { angles: [0 * DEGREE, -20 * DEGREE, 0 * DEGREE] })
const ear_left_tip = cad.translate(ear_left_tip_rot, { offset: [-16 * MM, 0 * MM, 108 * MM] })
ear_left_tip.setColor(COLOR_BLACK)
ear_left_tip.setName('左耳上部')

// ===== 右耳：同样的两节处理 =====
const ear_right_base_ball = cad.sphere({ radius: 1 * MM, segments: 64 })
const ear_right_base_ellipsoid = cad.scale3d(ear_right_base_ball, { factor: [7, 6, 20] })
const ear_right_base_cutter = cad.box(40 * MM, 40 * MM, 40 * MM, { at: [0 * MM, 0 * MM, 8 * MM] })
const ear_right_base_local = cad.subtract(ear_right_base_ellipsoid, ear_right_base_cutter)
const ear_right_base_rot = cad.rotate_euler(ear_right_base_local, { angles: [0 * DEGREE, 20 * DEGREE, 0 * DEGREE] })
const ear_right_base = cad.translate(ear_right_base_rot, { offset: [16 * MM, 0 * MM, 108 * MM] })
ear_right_base.setColor(COLOR_YELLOW)
ear_right_base.setName('右耳下部')

const ear_right_tip_ball = cad.sphere({ radius: 1 * MM, segments: 64 })
const ear_right_tip_ellipsoid = cad.scale3d(ear_right_tip_ball, { factor: [7, 6, 20] })
const ear_right_tip_cutter = cad.box(40 * MM, 40 * MM, 40 * MM, { at: [0 * MM, 0 * MM, 8 * MM] })
const ear_right_tip_local = cad.intersect(ear_right_tip_ellipsoid, ear_right_tip_cutter)
const ear_right_tip_rot = cad.rotate_euler(ear_right_tip_local, { angles: [0 * DEGREE, 20 * DEGREE, 0 * DEGREE] })
const ear_right_tip = cad.translate(ear_right_tip_rot, { offset: [16 * MM, 0 * MM, 108 * MM] })
ear_right_tip.setColor(COLOR_BLACK)
ear_right_tip.setName('右耳上部')

const eye_left_ball = cad.sphere({ radius: 5 * MM, segments: 48 })
const eye_left = cad.translate(eye_left_ball, { offset: [-13 * MM, -24 * MM, 84 * MM] })
eye_left.setColor(COLOR_BLACK)
eye_left.setName('左眼')

const eye_right_ball = cad.sphere({ radius: 5 * MM, segments: 48 })
const eye_right = cad.translate(eye_right_ball, { offset: [13 * MM, -24 * MM, 84 * MM] })
eye_right.setColor(COLOR_BLACK)
eye_right.setName('右眼')

const cheek_left_ball = cad.sphere({ radius: 1 * MM, segments: 48 })
const cheek_left_scaled = cad.scale3d(cheek_left_ball, { factor: [6, 3, 6] })
const cheek_left = cad.translate(cheek_left_scaled, { offset: [-15 * MM, -20 * MM, 65 * MM] })
cheek_left.setColor(COLOR_RED)
cheek_left.setName('左脸颊')

const cheek_right_ball = cad.sphere({ radius: 1 * MM, segments: 48 })
const cheek_right_scaled = cad.scale3d(cheek_right_ball, { factor: [6, 3, 6] })
const cheek_right = cad.translate(cheek_right_scaled, { offset: [15 * MM, -20 * MM, 65 * MM] })
cheek_right.setColor(COLOR_RED)
cheek_right.setName('右脸颊')

const nose_ball = cad.sphere({ radius: 2 * MM, segments: 32 })
const pikachu_nose = cad.translate(nose_ball, { offset: [0 * MM, -26.5 * MM, 76 * MM] })
pikachu_nose.setColor(COLOR_BLACK)
pikachu_nose.setName('鼻子')

const arm_left_ball = cad.sphere({ radius: 1 * MM, segments: 48 })
const arm_left_scaled = cad.scale3d(arm_left_ball, { factor: [7, 9, 12] })
const arm_left = cad.translate(arm_left_scaled, { offset: [-24 * MM, -2 * MM, 40 * MM] })
arm_left.setColor(COLOR_YELLOW)
arm_left.setName('左手臂')

const arm_right_ball = cad.sphere({ radius: 1 * MM, segments: 48 })
const arm_right_scaled = cad.scale3d(arm_right_ball, { factor: [7, 9, 12] })
const arm_right = cad.translate(arm_right_scaled, { offset: [24 * MM, -2 * MM, 40 * MM] })
arm_right.setColor(COLOR_YELLOW)
arm_right.setName('右手臂')

const foot_left_ball = cad.sphere({ radius: 1 * MM, segments: 48 })
const foot_left_scaled = cad.scale3d(foot_left_ball, { factor: [11, 14, 7] })
const foot_left = cad.translate(foot_left_scaled, { offset: [-13 * MM, -6 * MM, 7 * MM] })
foot_left.setColor(COLOR_YELLOW)
foot_left.setName('左脚')

const foot_right_ball = cad.sphere({ radius: 1 * MM, segments: 48 })
const foot_right_scaled = cad.scale3d(foot_right_ball, { factor: [11, 14, 7] })
const foot_right = cad.translate(foot_right_scaled, { offset: [13 * MM, -6 * MM, 7 * MM] })
foot_right.setColor(COLOR_YELLOW)
foot_right.setName('右脚')

const tail_a_box = cad.box(8 * MM, 10 * MM, 31 * MM, { centered: true })
const tail_a_rot = cad.rotate_euler(tail_a_box, { angles: [-31.6 * DEGREE, 0 * DEGREE, 0 * DEGREE] })
const tail_a = cad.translate(tail_a_rot, { offset: [0 * MM, 30 * MM, 33 * MM] })

const tail_b_box = cad.box(8 * MM, 10 * MM, 22 * MM, { centered: true })
const tail_b_rot = cad.rotate_euler(tail_b_box, { angles: [21.8 * DEGREE, 0 * DEGREE, 0 * DEGREE] })
const tail_b = cad.translate(tail_b_rot, { offset: [0 * MM, 34 * MM, 56 * MM] })

const tail_c_box = cad.box(8 * MM, 10 * MM, 27 * MM, { centered: true })
const tail_c_rot = cad.rotate_euler(tail_c_box, { angles: [-36 * DEGREE, 0 * DEGREE, 0 * DEGREE] })
const tail_c = cad.translate(tail_c_rot, { offset: [0 * MM, 38 * MM, 77 * MM] })

const tail_bc = cad.union(tail_b, tail_c)
const pikachu_tail = cad.union(tail_a, tail_bc)
pikachu_tail.setColor(COLOR_YELLOW)
pikachu_tail.setName('尾巴')

const pikachu = cad.group(pikachu_body, pikachu_head, ear_left_base, ear_left_tip, ear_right_base, ear_right_tip, eye_left, eye_right, cheek_left, cheek_right, pikachu_nose, arm_left, arm_right, foot_left, foot_right, pikachu_tail)
pikachu.setName('皮卡丘')