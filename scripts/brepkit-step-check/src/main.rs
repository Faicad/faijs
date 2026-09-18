//! brepkit STEP export probe — builds a fixed set of solids, writes each to a
//! STEP file, and prints a JSON manifest (case -> {file, volume, area, bbox,
//! faces}) so the JS side can compare against occt-wasm's output.

use std::collections::HashMap;
use std::path::PathBuf;

use brepkit_io::step::{read_step, write_step};
use brepkit_math::mat::Mat4;
use brepkit_operations::boolean::{boolean, BooleanOp};
use brepkit_operations::measure::{solid_bounding_box, solid_surface_area, solid_volume};
use brepkit_operations::primitives::{make_box, make_cone, make_cylinder, make_sphere, make_torus};
use brepkit_operations::transform::transform_solid;
use brepkit_topology::Topology;

/// Face-type census for a solid (counts surface kinds via the STEP text is not
/// available here — instead we report counts derived from the topology so the
/// JS side can compare the STEP entity census against it).
fn face_counts(topo: &Topology, solid: brepkit_topology::solid::SolidId) -> (u32, u32, u32, u32, u32) {
    let solid_data = topo.solid(solid).expect("solid exists");
    let shell = topo.shell(solid_data.outer_shell()).expect("shell exists");
    let (mut plane, mut cyl, mut cone, mut sphere, mut torus) = (0u32, 0u32, 0u32, 0u32, 0u32);
    for &fid in shell.faces() {
        let face = topo.face(fid).expect("face exists");
        match face.surface() {
            brepkit_topology::face::FaceSurface::Plane { .. } => plane += 1,
            brepkit_topology::face::FaceSurface::Cylinder(_) => cyl += 1,
            brepkit_topology::face::FaceSurface::Cone(_) => cone += 1,
            brepkit_topology::face::FaceSurface::Sphere(_) => sphere += 1,
            brepkit_topology::face::FaceSurface::Torus(_) => torus += 1,
            brepkit_topology::face::FaceSurface::Nurbs(_) => {}
        }
    }
    (plane, cyl, cone, sphere, torus)
}

fn bbox_of(topo: &Topology, solid: brepkit_topology::solid::SolidId) -> [f64; 6] {
    let bb = solid_bounding_box(topo, solid).expect("bbox");
    [bb.min.x(), bb.min.y(), bb.min.z(), bb.max.x(), bb.max.y(), bb.max.z()]
}

fn fmt(v: f64) -> String {
    format!("{v:.6}")
}

fn main() {
    let out_dir = std::env::args()
        .nth(1)
        .expect("usage: brepkit-step-check <out-dir>");
    std::fs::create_dir_all(&out_dir).expect("create out dir");

    let mut topo = Topology::new();
    let mut manifest: HashMap<String, serde_json::Value> = HashMap::new();

    // ── C01: box 10×20×30, centered at origin ──
    let box_c = {
        let s = make_box(&mut topo, 10.0, 20.0, 30.0).expect("box");
        transform_solid(&mut topo, s, &Mat4::translation(-5.0, -10.0, -15.0)).expect("translate");
        s
    };

    // ── C02: cylinder r=5 h=20, base at origin (no transform) ──
    let cyl_o = make_cylinder(&mut topo, 5.0, 20.0).expect("cyl");

    // ── C03: cylinder r=5 h=20, centered at origin (z from -10 to +10) ──
    let cyl_c = {
        let s = make_cylinder(&mut topo, 5.0, 20.0).expect("cyl");
        transform_solid(&mut topo, s, &Mat4::translation(0.0, 0.0, -10.0)).expect("translate");
        s
    };

    // ── C04: sphere r=7.5, centered at origin ──
    let sphere_c = make_sphere(&mut topo, 7.5, 32).expect("sphere");

    // ── C05: cone r1=5 r2=2 h=15, base at origin ──
    let cone_o = make_cone(&mut topo, 5.0, 2.0, 15.0).expect("cone");

    // ── C06: torus R=10 r=4, centered at origin ──
    let torus_c = make_torus(&mut topo, 10.0, 4.0, 4).expect("torus");

    // ── C07: box − cylinder (hole through the middle, cylinder centered) ──
    let cut_box_cyl = {
        let b = make_box(&mut topo, 10.0, 10.0, 10.0).expect("box");
        transform_solid(&mut topo, b, &Mat4::translation(-5.0, -5.0, -5.0)).expect("translate");
        let c = make_cylinder(&mut topo, 3.0, 10.0).expect("cyl");
        transform_solid(&mut topo, c, &Mat4::translation(0.0, 0.0, 0.0)).expect("translate");
        boolean(&mut topo, BooleanOp::Cut, b, c).expect("cut")
    };

    // ── C08: two boxes fused (partial overlap) ──
    let fuse_2box = {
        let b1 = make_box(&mut topo, 10.0, 10.0, 10.0).expect("box");
        transform_solid(&mut topo, b1, &Mat4::translation(-5.0, -5.0, -5.0)).expect("translate");
        let b2 = make_box(&mut topo, 10.0, 10.0, 10.0).expect("box");
        transform_solid(&mut topo, b2, &Mat4::translation(0.0, 0.0, 5.0)).expect("translate");
        boolean(&mut topo, BooleanOp::Fuse, b1, b2).expect("fuse")
    };

    // ── C09: box ∩ cylinder (intersection) ──
    let common_box_cyl = {
        let b = make_box(&mut topo, 8.0, 8.0, 8.0).expect("box");
        transform_solid(&mut topo, b, &Mat4::translation(-4.0, -4.0, -4.0)).expect("translate");
        let c = make_cylinder(&mut topo, 6.0, 8.0).expect("cyl");
        transform_solid(&mut topo, c, &Mat4::translation(0.0, 0.0, 0.0)).expect("translate");
        boolean(&mut topo, BooleanOp::Intersect, b, c).expect("intersect")
    };

    // ── C10: rotated cylinder (30° about X, base centered at origin) ──
    let cyl_rot = {
        let s = make_cylinder(&mut topo, 5.0, 20.0).expect("cyl");
        transform_solid(&mut topo, s, &Mat4::translation(0.0, 0.0, -10.0)).expect("translate");
        transform_solid(&mut topo, s, &Mat4::rotation_x(std::f64::consts::PI / 6.0)).expect("rotate");
        s
    };

    let cases: Vec<(&str, brepkit_topology::solid::SolidId)> = vec![
        ("C01_box_centered", box_c),
        ("C02_cylinder_origin", cyl_o),
        ("C03_cylinder_centered", cyl_c),
        ("C04_sphere_centered", sphere_c),
        ("C05_cone_origin", cone_o),
        ("C06_torus_centered", torus_c),
        ("C07_box_cut_cylinder", cut_box_cyl),
        ("C08_fuse_two_boxes", fuse_2box),
        ("C09_common_box_cylinder", common_box_cyl),
        ("C10_cylinder_rotated", cyl_rot),
    ];

    for (name, solid) in &cases {
        let (plane, cyl, cone, sphere, torus) = face_counts(&topo, *solid);
        let vol = solid_volume(&topo, *solid, 0.01).expect("volume");
        let area = solid_surface_area(&topo, *solid, 0.01).expect("area");
        let bbox = bbox_of(&topo, *solid);
        let step = write_step(&topo, std::slice::from_ref(solid)).expect("write_step");
        let file = PathBuf::from(&out_dir).join(format!("{name}.step"));
        std::fs::write(&file, step.as_bytes()).expect("write file");

        let mut entry = serde_json::Map::new();
        entry.insert("file".into(), serde_json::Value::String(format!("{name}.step")));
        entry.insert("bytes".into(), serde_json::json!(step.len()));
        entry.insert("volume".into(), serde_json::Value::String(fmt(vol)));
        entry.insert("area".into(), serde_json::Value::String(fmt(area)));
        entry.insert(
            "bbox".into(),
            serde_json::json!([
                fmt(bbox[0]), fmt(bbox[1]), fmt(bbox[2]),
                fmt(bbox[3]), fmt(bbox[4]), fmt(bbox[5])
            ]),
        );
        entry.insert(
            "faces".into(),
            serde_json::json!({
                "plane": plane, "cylinder": cyl, "cone": cone, "sphere": sphere, "torus": torus
            }),
        );
        entry.insert("step_lines".into(), serde_json::json!(step.lines().count()));
        manifest.insert(name.to_string(), serde_json::Value::Object(entry));
    }

    let out = PathBuf::from(&out_dir).join("manifest.json");
    let json = serde_json::to_string_pretty(&manifest).expect("serialize");
    std::fs::write(&out, json).expect("write manifest");
    println!("brepkit probe wrote {} cases to {}", manifest.len(), out_dir);

    // ── Round-trip: read our own STEP back, report volume to check reader ──
    let rt_dir = std::path::Path::new(&out_dir).join("roundtrip");
    std::fs::create_dir_all(&rt_dir).expect("create rt dir");
    let mut rt: HashMap<String, serde_json::Value> = HashMap::new();
    for (name, _) in &cases {
        let path = PathBuf::from(&out_dir).join(format!("{name}.step"));
        let text = std::fs::read_to_string(&path).expect("read step");
        let mut rt_topo = Topology::new();
        match read_step(&text, &mut rt_topo) {
            Ok(solids) => {
                let mut vols = Vec::new();
                for s in &solids {
                    let v = solid_volume(&rt_topo, *s, 0.01).expect("rt volume");
                    vols.push(fmt(v));
                }
                let mut entry = serde_json::Map::new();
                entry.insert("solids".into(), serde_json::json!(solids.len()));
                entry.insert("volumes".into(), serde_json::json!(vols));
                rt.insert(name.to_string(), serde_json::Value::Object(entry));
            }
            Err(e) => {
                let mut entry = serde_json::Map::new();
                entry.insert("error".into(), serde_json::Value::String(format!("{e:?}")));
                rt.insert(name.to_string(), serde_json::Value::Object(entry));
            }
        }
    }
    let rt_path = rt_dir.join("manifest.json");
    std::fs::write(&rt_path, serde_json::to_string_pretty(&rt).expect("serialize")).expect("write");
    println!("round-trip manifest -> {}", rt_path.display());
}
