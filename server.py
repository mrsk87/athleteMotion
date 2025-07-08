from fastapi import FastAPI, UploadFile, File
import cv2
import mediapipe as mp
import numpy as np
import uvicorn
import math
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Configurar CORS para permitir requisições do frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inicializar o MediaPipe Pose
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(
    static_image_mode=False,
    model_complexity=2,  # Voltamos para 2 para melhorar precisão na detecção lateral
    enable_segmentation=False,
    smooth_landmarks=True,  # Suavizar movimentos para evitar pulos
    min_detection_confidence=0.3,  # Reduzido para detectar mesmo em poses parciais
    min_tracking_confidence=0.3  # Reduzido para melhor tracking em posições laterais
)

# Definir ângulos ideais para ciclismo (em graus)
IDEAL_ANGLES = {
    "joelho": {"min": 70, "max": 110},  # Ângulo do joelho durante pedalada
    "tornozelo": {"min": 80, "max": 110},  # Ângulo do tornozelo
    "costas": {"min": 40, "max": 60},  # Inclinação das costas (em relação à vertical)
    "braço": {"min": 150, "max": 175}   # Extensão do braço - Ampliada a faixa mínima para melhorar detecção
}

# Mapear nomes dos landmarks para facilitar o acesso
LANDMARK_MAPPING = {
    "nariz": 0,
    "ombro_direito": 11, 
    "ombro_esquerdo": 12,
    "cotovelo_direito": 13, 
    "cotovelo_esquerdo": 14,
    "pulso_direito": 15, 
    "pulso_esquerdo": 16,
    "quadril_direito": 23, 
    "quadril_esquerdo": 24,
    "joelho_direito": 25, 
    "joelho_esquerdo": 26,
    "tornozelo_direito": 27, 
    "tornozelo_esquerdo": 28
}

def calculate_angle(a, b, c):
    """Calcula o ângulo entre três pontos"""
    a = np.array([a.x, a.y])
    b = np.array([b.x, b.y])
    c = np.array([c.x, c.y])
    
    radians = np.arctan2(c[1] - b[1], c[0] - b[0]) - np.arctan2(a[1] - b[1], a[0] - b[0])
    angle = np.abs(radians * 180.0 / np.pi)
    
    if angle > 180.0:
        angle = 360 - angle
        
    return angle

@app.post("/process_frame")
async def process_frame(file: UploadFile = File(...)):
    # Ler o frame enviado pelo frontend
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    # Converter o frame para RGB
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # Processar o frame diretamente sem modificações intensas
    # Isso proporcionará uma análise mais natural, mantendo as cores e a aparência original
    results = pose.process(rgb_frame)

    # Se não detectou pose, retornar vazio
    if not results.pose_landmarks:
        return {"landmarks": [], "angles": {}}
        
    # Preparar os landmarks
    landmarks = []
    for landmark in results.pose_landmarks.landmark:
        # Garantir que os valores sejam nativos do Python (float), não tipos numpy
        landmarks.append({
            "x": float(landmark.x), 
            "y": float(landmark.y), 
            "z": float(landmark.z)
        })
    
    # Calcular ângulos das articulações
    angles = {}
    
    # Joelho direito (quadril - joelho - tornozelo)
    # Verificar se os pontos são visíveis (não apenas se têm valor x > 0)
    if all(idx < len(landmarks) for idx in [mp_pose.PoseLandmark.RIGHT_HIP.value, 
                                        mp_pose.PoseLandmark.RIGHT_KNEE.value, 
                                        mp_pose.PoseLandmark.RIGHT_ANKLE.value]):
        knee_angle = calculate_angle(
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_HIP.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_KNEE.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_ANKLE.value]
        )
        angles["joelho_direito"] = {
            "angle": float(knee_angle),
            "correct": bool(IDEAL_ANGLES["joelho"]["min"] <= knee_angle <= IDEAL_ANGLES["joelho"]["max"])
        }
    
    # Joelho esquerdo
    if all(idx < len(landmarks) for idx in [mp_pose.PoseLandmark.LEFT_HIP.value, 
                                        mp_pose.PoseLandmark.LEFT_KNEE.value, 
                                        mp_pose.PoseLandmark.LEFT_ANKLE.value]):
        knee_angle = calculate_angle(
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_HIP.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_KNEE.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_ANKLE.value]
        )
        angles["joelho_esquerdo"] = {
            "angle": float(knee_angle),
            "correct": bool(IDEAL_ANGLES["joelho"]["min"] <= knee_angle <= IDEAL_ANGLES["joelho"]["max"])
        }
        
    # Tornozelo direito (joelho - tornozelo - pé)
    if all(idx < len(landmarks) for idx in [mp_pose.PoseLandmark.RIGHT_KNEE.value, 
                                        mp_pose.PoseLandmark.RIGHT_ANKLE.value, 
                                        mp_pose.PoseLandmark.RIGHT_FOOT_INDEX.value]):
        ankle_angle = calculate_angle(
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_KNEE.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_ANKLE.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_FOOT_INDEX.value]
        )
        angles["tornozelo_direito"] = {
            "angle": float(ankle_angle),
            "correct": bool(IDEAL_ANGLES["tornozelo"]["min"] <= ankle_angle <= IDEAL_ANGLES["tornozelo"]["max"])
        }
    
    # Tornozelo esquerdo
    if all(idx < len(landmarks) for idx in [mp_pose.PoseLandmark.LEFT_KNEE.value, 
                                        mp_pose.PoseLandmark.LEFT_ANKLE.value, 
                                        mp_pose.PoseLandmark.LEFT_FOOT_INDEX.value]):
        ankle_angle = calculate_angle(
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_KNEE.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_ANKLE.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_FOOT_INDEX.value]
        )
        angles["tornozelo_esquerdo"] = {
            "angle": float(ankle_angle),
            "correct": bool(IDEAL_ANGLES["tornozelo"]["min"] <= ankle_angle <= IDEAL_ANGLES["tornozelo"]["max"])
        }
    
    # Costas (inclinação - ombro, quadril, joelho)
    if all(idx < len(landmarks) for idx in [mp_pose.PoseLandmark.RIGHT_SHOULDER.value, 
                                        mp_pose.PoseLandmark.RIGHT_HIP.value, 
                                        mp_pose.PoseLandmark.RIGHT_KNEE.value]):
        back_angle = calculate_angle(
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_SHOULDER.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_HIP.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_KNEE.value]
        )
        angles["costas"] = {
            "angle": float(back_angle),
            "correct": bool(IDEAL_ANGLES["costas"]["min"] <= back_angle <= IDEAL_ANGLES["costas"]["max"])
        }
    
    # Braços (ombro - cotovelo - pulso)
    if all(idx < len(landmarks) for idx in [mp_pose.PoseLandmark.RIGHT_SHOULDER.value, 
                                        mp_pose.PoseLandmark.RIGHT_ELBOW.value, 
                                        mp_pose.PoseLandmark.RIGHT_WRIST.value]):
        arm_angle = calculate_angle(
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_SHOULDER.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_ELBOW.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.RIGHT_WRIST.value]
        )
        angles["braço_direito"] = {
            "angle": float(arm_angle),
            "correct": bool(IDEAL_ANGLES["braço"]["min"] <= arm_angle <= IDEAL_ANGLES["braço"]["max"])
        }
    
    if all(idx < len(landmarks) for idx in [mp_pose.PoseLandmark.LEFT_SHOULDER.value, 
                                        mp_pose.PoseLandmark.LEFT_ELBOW.value, 
                                        mp_pose.PoseLandmark.LEFT_WRIST.value]):
        arm_angle = calculate_angle(
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_SHOULDER.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_ELBOW.value],
            results.pose_landmarks.landmark[mp_pose.PoseLandmark.LEFT_WRIST.value]
        )
        angles["braço_esquerdo"] = {
            "angle": float(arm_angle),
            "correct": bool(IDEAL_ANGLES["braço"]["min"] <= arm_angle <= IDEAL_ANGLES["braço"]["max"])
        }

    return {"landmarks": landmarks, "angles": angles}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
