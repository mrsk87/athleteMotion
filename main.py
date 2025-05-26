import cv2
import mediapipe as mp

# Inicializar o MediaPipe Face Mesh
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(static_image_mode=False, max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.5)

# Inicializar o MediaPipe DrawingUtils para desenhar os pontos
mp_drawing = mp.solutions.drawing_utils

# Inicializar a captura de vídeo da webcam
cap = cv2.VideoCapture(0)

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        print("Erro ao capturar o frame.")
        break

    # Converter o frame para RGB (o MediaPipe usa RGB)
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    # Processar o frame com o Face Mesh
    results = face_mesh.process(rgb_frame)

    # Desenhar os pontos faciais no frame
    if results.multi_face_landmarks:
        for face_landmarks in results.multi_face_landmarks:
            # Desenhar os pontos e conexões faciais
            mp_drawing.draw_landmarks(
                frame,
                face_landmarks,
                mp_face_mesh.FACEMESH_CONTOURS,
                mp_drawing.DrawingSpec(color=(0, 255, 0), thickness=1, circle_radius=1),
                mp_drawing.DrawingSpec(color=(0, 0, 255), thickness=1)
            )

    if results.multi_face_landmarks:
        for face_landmarks in results.multi_face_landmarks:
            # Coordenadas dos pontos dos lábios
            top_lip = face_landmarks.landmark[13].y  # Ponto superior do lábio
            bottom_lip = face_landmarks.landmark[14].y  # Ponto inferior do lábio

            # Verificar se há um sorriso
            if bottom_lip - top_lip > 0.02:  # Ajuste o valor conforme necessário
                print("Sorriso detectado!")

    # Exibir o frame
    cv2.imshow('MediaPipe Face Mesh', frame)

    # Sair do loop se a tecla 'q' for pressionada
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Liberar recursos
cap.release()
cv2.destroyAllWindows()