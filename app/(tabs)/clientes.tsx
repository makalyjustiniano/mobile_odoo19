import {
  ScrollView,
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
  Dimensions,
  RefreshControl
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { FontAwesome } from '@expo/vector-icons';
import { callOdoo } from '../../src/api/odooClient';
import { useEffect, useState } from 'react';
import { useConfigStore } from '../../src/store/configStore';
import * as db from '../../src/services/dbService';
import { getSiatDomain } from '../../src/utils/permissionUtils';
import { useAuthStore } from '../../src/store/authStore';
import { syncPortalMetadata, uploadAndSync } from '../../src/services/syncService';
import ListFilters, { DateFilterType } from '../../src/components/ListFilters';

interface Partner {
  id: number;
  display_name: string;
  email: string | false;
  phone: string | false;
  lang: string | false;
  vat?: string | false;
  street?: string | false;
  street2?: string | false;
  city?: string | false;
  zip?: string | false;
  credit?: number;
  debit?: number;
  credit_limit?: number;
  total_due?: number;
  total_overdue?: number;
  comment?: string | false;
  image_128?: string | false;
  x_studio_razon_social?: string | false;
  [key: string]: any;
}

export default function Index() {

  const isOffline = useConfigStore((state) => state.isOffline);

  useEffect(() => {
    fetchPartners();
  }, [isOffline]);

  const [result, setResult] = useState<Partner[]>([]);
  const [filteredResult, setFilteredResult] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  
  // Filters state
  const [limit, setLimit] = useState<number>(250);
  const [offset, setOffset] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [dateFilter, setDateFilter] = useState<DateFilterType>('All');
  
  // Form state (New Partner)
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // Edit state (Existing Partner)
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editVat, setEditVat] = useState('');
  const [editStreet, setEditStreet] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editZip, setEditZip] = useState('');
  const [editRazonSocial, setEditRazonSocial] = useState('');
  const [editComplemento, setEditComplemento] = useState('');
  const [editGiro, setEditGiro] = useState('');
  const [editPagoProveedor, setEditPagoProveedor] = useState('');
  const [editPagoCliente, setEditPagoCliente] = useState('');
  const [editTipoDocumento, setEditTipoDocumento] = useState('');
  
  // Map/Location States
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [currentLat, setCurrentLat] = useState<number | null>(null);
  const [currentLng, setCurrentLng] = useState<number | null>(null);
  const [tempLat, setTempLat] = useState<number | null>(null);
  const [tempLng, setTempLng] = useState<number | null>(null);
  const [mapMode, setMapMode] = useState<'create' | 'edit' | 'view'>('create');
  
  // Advanced Map Options
  const [searchAddress, setSearchAddress] = useState('');
  const [mapRegion, setMapRegion] = useState({
    latitude: -16.5000,
    longitude: -68.1500,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  });

  const handleNextPage = () => {
    if (offset + limit < totalCount) {
        setOffset(offset + limit);
        fetchPartners(false, offset + limit);
    }
  };

  const handlePrevPage = () => {
    const newOffset = Math.max(0, offset - limit);
    if (newOffset !== offset) {
        setOffset(newOffset);
        fetchPartners(false, newOffset);
    }
  };

  const handleManualSync = async () => {
    setLoading(true);
    try {
      const { success, errors } = await uploadAndSync((msg) => console.log(`[MANUAL SYNC] ${msg}`));
      if (!success) {
        Alert.alert(
          'Sincronización Parcial',
          `Se descargaron datos de Odoo, pero algunos registros locales no pudieron subirse:\n\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`
        );
      } else {
        Alert.alert('Éxito', 'Sincronización completada correctamente.');
      }
      await fetchPartners(true);
    } catch (error: any) {
      Alert.alert('Error', 'No se pudo conectar con Odoo: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPartners = async (isPullToRefresh = false, customOffset?: number) => {
    const currentOffset = customOffset !== undefined ? customOffset : (isPullToRefresh ? 0 : offset);
    if (isPullToRefresh) setOffset(0);
    try {
      if (isPullToRefresh) setRefreshing(true);
      else setLoading(true);
      
      // 1. CARGA INSTANTÁNEA (Siempre de SQLite primero)
      console.log('Cargando clientes de SQLite...');
      const localData = await db.getPartners();
      setResult(localData as any);
      setFilteredResult(localData as any);
      if (localData.length > 0 && !isPullToRefresh) setLoading(false);

      // 2. ACTUALIZACIÓN EN SEGUNDO PLANO (Si online o si se pide pull-refresh)
      if (!isOffline) {
        console.log('Sincronizando clientes con Odoo...');
        try {
          const user = useAuthStore.getState().user;
          const partnerDomain = getSiatDomain('res.partner', user);
          
          const odooData = await callOdoo('res.partner', 'search_read', {
            domain: partnerDomain,
            fields: [
              "display_name", "email", "phone", "lang", "vat",
              "street", "street2", "city", "zip",
              "credit", "debit", "credit_limit", "total_due", "total_overdue",
              "comment", "image_128", 
              "x_studio_razon_social", "x_studio_complemento", "x_studio_giro",
              "x_studio_pago_a_proveedor", "x_studio_pago_de_cliente", "x_studio_tipo_de_documento",
              "user_id", "company_id", "partner_latitude", "partner_longitude"
            ],
            limit: limit,
            offset: currentOffset
          }, true);
          
          const count: number = await callOdoo('res.partner', 'search_count', {
            domain: partnerDomain
          }, true);
          setTotalCount(count);
          
          if (odooData && Array.isArray(odooData)) {
              await db.savePartners(odooData);
              const freshLocal = await db.getPartners();
              setResult(freshLocal as any);
              setFilteredResult(freshLocal as any);
          }
        } catch (e) {
          console.warn('Fallo actualización online de clientes.');
        }
      }
    } catch (error: any) {
      console.error('Error fetchPartners:', error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (!text.trim()) {
      setFilteredResult(result);
      return;
    }

    const filtered = result.filter(p => 
      p.display_name.toLowerCase().includes(text.toLowerCase()) ||
      (p.vat && p.vat.toLowerCase().includes(text.toLowerCase()))
    );
    setFilteredResult(filtered);

    // Si no hay resultados locales y estamos online, buscamos en Odoo
    if (filtered.length === 0 && !isOffline && text.length > 2) {
        try {
            const user = useAuthStore.getState().user;
            const odooRes = await callOdoo('res.partner', 'search_read', {
                domain: [['name', 'ilike', text]],
                fields: ["display_name", "vat", "email", "phone", "image_128"],
                limit: 10
            }, true);
            if (odooRes && odooRes.length > 0) {
                // Combinamos sin duplicar IDs
                setFilteredResult(odooRes as any);
            }
        } catch (e) {
            console.log('Online search fail');
        }
    }
  };

  const handleSavePartner = async () => {
    if (!newName) {
      Alert.alert('Error', 'El nombre es obligatorio');
      return;
    }

    try {
      setLoading(true);
      if (isOffline) {
        await db.createPartnerLocal({
          display_name: newName,
          email: newEmail,
          phone: newPhone,
          partner_latitude: currentLat,
          partner_longitude: currentLng
        });
        Alert.alert('Modo Offline', 'Cliente guardado localmente.');
      } else {
        await callOdoo('res.partner', 'create', {
          vals_list: [{
            name: newName,
            email: newEmail,
            phone: newPhone,
            partner_latitude: currentLat,
            partner_longitude: currentLng
          }]
        });
        Alert.alert('Éxito', 'Cliente registrado en Odoo.');
      }
      
      setModalVisible(false);
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      fetchPartners();
    } catch (error: any) {
      Alert.alert('Error', 'No se pudo guardar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePartner = async () => {
    if (!selectedPartner) return;
    if (!editName) {
      Alert.alert('Error', 'El nombre es obligatorio');
      return;
    }

    try {
      setLoading(true);
      const updatedData = {
        id: selectedPartner.id,
        display_name: editName,
        email: editEmail,
        phone: editPhone,
        vat: editVat,
        street: editStreet,
        city: editCity,
        zip: editZip,
        x_studio_razon_social: editRazonSocial,
        x_studio_complemento: editComplemento,
        x_studio_giro: editGiro,
        x_studio_pago_a_proveedor: editPagoProveedor,
        x_studio_pago_de_cliente: editPagoCliente,
        x_studio_tipo_de_documento: editTipoDocumento,
        partner_latitude: currentLat,
        partner_longitude: currentLng
      };

      // INMEDIATAMENTE actualizamos la DB local para consistencia visual (sin esperar a Odoo)
      await db.updatePartnerLocal(updatedData);

      if (isOffline) {
        Alert.alert('Modo Offline', 'Cambios guardados localmente.');
      } else {
        await callOdoo('res.partner', 'write', {
            ids: [selectedPartner.id],
            vals: {
                name: editName,
                email: editEmail,
                phone: editPhone,
                vat: editVat,
                street: editStreet,
                city: editCity,
                zip: editZip,
                x_studio_razon_social: editRazonSocial,
                x_studio_complemento: editComplemento,
                x_studio_giro: editGiro,
                x_studio_pago_a_proveedor: editPagoProveedor,
                x_studio_pago_de_cliente: editPagoCliente,
                x_studio_tipo_de_documento: editTipoDocumento,
                partner_latitude: currentLat,
                partner_longitude: currentLng
            }
        });
        Alert.alert('Éxito', 'Cliente actualizado en Odoo.');
      }

      // Actualizamos estado en memoria inmediatamente
      setResult(prev => prev.map(p => p.id === selectedPartner.id ? { ...p, ...updatedData } : p));

      setIsEditing(false);
      setDetailModalVisible(false);
      
      // Sincronizamos silenciosamente de fondo
      fetchPartners();
    } catch (error: any) {
      Alert.alert('Error', 'No se pudo actualizar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGetLocation = async () => {
    try {
      setLoading(true);
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso denegado', 'Se requiere acceso a la ubicación para capturar coordenadas.');
        return;
      }

      let location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCurrentLat(location.coords.latitude);
      setCurrentLng(location.coords.longitude);
      setTempLat(location.coords.latitude);
      setTempLng(location.coords.longitude);
      
      Alert.alert('Éxito', 'Ubicación capturada correctamente.');
    } catch (e: any) {
      Alert.alert('Error', 'No se pudo obtener la ubicación: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenMap = (mode: 'create' | 'edit' | 'view') => {
    setMapMode(mode);
    setTempLat(currentLat);
    setTempLng(currentLng);
    setSearchAddress('');
    
    if (currentLat && currentLng) {
      setMapRegion({ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.005, longitudeDelta: 0.005 });
    } else {
      setMapRegion({ latitude: -16.5000, longitude: -68.1500, latitudeDelta: 0.05, longitudeDelta: 0.05 }); // La Paz default
    }
    
    setMapModalVisible(true);
  };

  const handleSearchLocation = async () => {
    if (!searchAddress.trim()) return;
    try {
      setLoading(true);
      const results = await Location.geocodeAsync(searchAddress);
      if (results && results.length > 0) {
        const { latitude, longitude } = results[0];
        setTempLat(latitude);
        setTempLng(longitude);
        setMapRegion({ latitude, longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 });
      } else {
        Alert.alert('Sin resultados', 'No se encontró la dirección indicada.');
      }
    } catch (e: any) {
      Alert.alert('Error', 'No se pudo buscar la dirección.');
    } finally {
      setLoading(false);
    }
  };

  const handleCenterOnMeMap = async () => {
    try {
      setLoading(true);
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      let location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = location.coords;
      setTempLat(latitude);
      setTempLng(longitude);
      setMapRegion({ latitude, longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 });
    } catch (e: any) {
      Alert.alert('Error', 'No se pudo obtener tu posición.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmMapLocation = () => {
    if (tempLat && tempLng) {
      setCurrentLat(tempLat);
      setCurrentLng(tempLng);
    }
    setMapModalVisible(false);
  };

  const openDetails = (partner: Partner) => {
    setSelectedPartner(partner);
    setEditName(partner.display_name || '');
    setEditEmail(partner.email || '');
    setEditPhone(partner.phone || '');
    setEditVat(partner.vat || '');
    setEditStreet(partner.street || '');
    setEditCity(partner.city || '');
    setEditZip(partner.zip || '');
    setEditRazonSocial(partner.x_studio_razon_social || '');
    setEditComplemento(partner.x_studio_complemento || '');
    setEditGiro(partner.x_studio_giro || '');
    setEditPagoProveedor(partner.x_studio_pago_a_proveedor || '');
    setEditPagoCliente(partner.x_studio_pago_de_cliente || '');
    setEditTipoDocumento(partner.x_studio_tipo_de_documento || '');
    setCurrentLat(partner.partner_latitude || null);
    setCurrentLng(partner.partner_longitude || null);
    setIsEditing(false);
    setDetailModalVisible(true);
  };

  const isAuditMode = useAuthStore.getState().isAuditMode;

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Gestión de Clientes</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {!isAuditMode && (
            <TouchableOpacity style={[styles.newButton, { marginRight: 15 }]} onPress={() => setModalVisible(true)}>
              <FontAwesome name="plus" size={14} color="#fff" />
              <Text style={styles.newButtonText}> NUEVO</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            onPress={() => fetchPartners(true)} 
            disabled={loading || isAuditMode}
            style={{ opacity: isAuditMode ? 0.3 : 1 }}
          >
            <FontAwesome name="refresh" size={20} color="#714B67" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Barra de búsqueda */}
      <View style={styles.searchContainer}>
        <FontAwesome name="search" size={20} color="#714B67" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar clientes por nombre..."
          value={searchQuery}
          onChangeText={handleSearch}
          placeholderTextColor="#9ca3af"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => handleSearch('')} style={styles.clearSearchBtn}>
            <FontAwesome name="times-circle" size={18} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>

      <ListFilters
          limit={limit}
          setLimit={(v) => { setLimit(v); setOffset(0); }}
          dateFilter={dateFilter}
          setDateFilter={(v) => { setDateFilter(v); setOffset(0); }}
          onApply={() => { setOffset(0); fetchPartners(false); }}
          showDateFilter={false}
          disabled={isOffline || useAuthStore.getState().isAuditMode}
          offset={offset}
          totalCount={totalCount}
          onNextPage={handleNextPage}
          onPrevPage={handlePrevPage}
      />

      <ScrollView 
        contentContainerStyle={{ gap: 16, padding: 15 }}
        refreshControl={
            <RefreshControl 
                refreshing={refreshing} 
                onRefresh={() => fetchPartners(true)} 
                colors={['#714B67']}
            />
        }
      >
        {loading && !refreshing && <ActivityIndicator color="#714B67" />}
        {filteredResult.map((partner) => (
          <TouchableOpacity 
            key={partner.id.toString()} 
            style={styles.card}
            onPress={() => openDetails(partner)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={styles.avatar}>
                    {partner.image_128 ? (
                      <Image 
                        source={{ uri: `data:image/png;base64,${partner.image_128}` }} 
                        style={styles.avatarImage} 
                      />
                    ) : (
                      <Text style={styles.avatarText}>{partner.display_name.charAt(0).toUpperCase()}</Text>
                    )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.name} numberOfLines={1}>{partner.display_name}</Text>
                    <View style={styles.infoRow}>
                        <FontAwesome name="id-card" size={12} color="#6B7280" />
                        <Text style={styles.infoText}>{partner.vat || 'Sin NIT/CI'}</Text>
                    </View>
                    {!!partner.phone && (
                        <View style={styles.infoRow}>
                            <FontAwesome name="phone" size={12} color="#6B7280" />
                            <Text style={styles.infoText}>{partner.phone}</Text>
                        </View>
                    )}
                </View>
                <FontAwesome name="chevron-right" size={14} color="#D1D5DB" />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* MODAL NUEVO CLIENTE */}
      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nuevo Cliente</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <FontAwesome name="times" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.label}>Nombre</Text>
              <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Nombre completo" />
              <Text style={styles.label}>Email</Text>
              <TextInput style={styles.input} value={newEmail} onChangeText={setNewEmail} placeholder="ejemplo@correo.com" keyboardType="email-address" />
              <Text style={styles.label}>Teléfono</Text>
              <TextInput style={styles.input} value={newPhone} onChangeText={setNewPhone} placeholder="+591 ..." keyboardType="phone-pad" />
              
              <Text style={styles.label}>Ubicación (Lat: {currentLat?.toFixed(4) || 'N/D'}, Lng: {currentLng?.toFixed(4) || 'N/D'})</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15 }}>
                <TouchableOpacity style={[styles.locationBtn, { flex: 1 }]} onPress={handleGetLocation}>
                  <FontAwesome name="location-arrow" size={14} color="#fff" />
                  <Text style={styles.locationBtnText}> MI POSICIÓN</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.locationBtn, { flex: 1, backgroundColor: '#714B67' }]} onPress={() => handleOpenMap('create')}>
                  <FontAwesome name="map" size={14} color="#fff" />
                  <Text style={styles.locationBtnText}> BUSCAR EN MAPA</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.saveBtn} onPress={handleSavePartner} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>GUARDAR CLIENTE</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL DETALLES DEL CLIENTE */}
      <Modal visible={detailModalVisible} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: '85%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isEditing ? 'Editar Contacto' : 'Detalles del Contacto'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 15, alignItems: 'center' }}>
                {!isAuditMode && (
                  <TouchableOpacity onPress={() => setIsEditing(!isEditing)}>
                    <FontAwesome name={isEditing ? "close" : "edit"} size={22} color="#00A09D" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setDetailModalVisible(false)}>
                  <FontAwesome name="times" size={24} color="#6B7280" />
                </TouchableOpacity>
              </View>
            </View>
            
            {!!selectedPartner && (
              <ScrollView style={styles.modalBody}>
                {!isEditing && (
                  <View style={styles.detailHeader}>
                    <View style={styles.largeAvatar}>
                      {!!selectedPartner.image_128 ? (
                        <Image 
                          source={{ uri: `data:image/png;base64,${selectedPartner.image_128}` }} 
                          style={styles.largeAvatarImage} 
                        />
                      ) : (
                        <Text style={styles.largeAvatarText}>{selectedPartner.display_name.charAt(0).toUpperCase()}</Text>
                      )}
                    </View>
                    <Text style={styles.detailName}>{selectedPartner.display_name}</Text>
                    {!!selectedPartner.x_studio_razon_social && (
                      <Text style={styles.detailSub}>{selectedPartner.x_studio_razon_social}</Text>
                    )}
                  </View>
                )}

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>INFORMACIÓN BÁSICA</Text>
                  {isEditing ? (
                    <>
                      <Text style={styles.label}>Nombre</Text>
                      <TextInput style={styles.input} value={editName} onChangeText={setEditName} />
                      <Text style={styles.label}>NIT/CI</Text>
                      <TextInput style={styles.input} value={editVat} onChangeText={setEditVat} />
                      <Text style={styles.label}>Email</Text>
                      <TextInput style={styles.input} value={editEmail} onChangeText={setEditEmail} keyboardType="email-address" />
                      <Text style={styles.label}>Teléfono</Text>
                      <TextInput style={styles.input} value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad" />
                    </>
                  ) : (
                    <>
                      <DetailRow icon="id-card" label="NIT/CI" value={selectedPartner?.vat} />
                      <DetailRow icon="envelope" label="Email" value={selectedPartner?.email} />
                      <DetailRow icon="phone" label="Teléfono" value={selectedPartner?.phone} />
                      <DetailRow icon="language" label="Idioma" value={selectedPartner?.lang} />
                    </>
                  )}
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>DIRECCIÓN</Text>
                  {isEditing ? (
                    <>
                      <Text style={styles.label}>Calle</Text>
                      <TextInput style={styles.input} value={editStreet} onChangeText={setEditStreet} />
                      <Text style={styles.label}>Ciudad</Text>
                      <TextInput style={styles.input} value={editCity} onChangeText={setEditCity} />
                      <Text style={styles.label}>Código Postal</Text>
                      <TextInput style={styles.input} value={editZip} onChangeText={setEditZip} />
                    </>
                  ) : (
                    <>
                      <DetailRow icon="map-marker" label="Calle" value={selectedPartner?.street} />
                      {!!selectedPartner?.street2 && <DetailRow icon="map-marker" label="Calle 2" value={selectedPartner?.street2} />}
                      <DetailRow icon="building" label="Ciudad" value={selectedPartner?.city} />
                      <DetailRow icon="envelope-o" label="Código Postal" value={selectedPartner?.zip} />
                    </>
                  )}
                </View>

                {!isEditing && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>RESUMEN FINANCIERO</Text>
                    <View style={styles.financeGrid}>
                      <FinanceItem label="Por Cobrar" value={selectedPartner?.credit} color="#10B981" />
                      <FinanceItem label="Por Pagar" value={selectedPartner?.debit} color="#EF4444" />
                      <FinanceItem label="Vencido" value={selectedPartner?.total_overdue} color="#F59E0B" />
                      <FinanceItem label="Límite" value={selectedPartner?.credit_limit} color="#6B7280" />
                    </View>
                  </View>
                )}

                {!isEditing && !!selectedPartner?.comment && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>NOTAS</Text>
                    <Text style={styles.commentText}>{selectedPartner?.comment}</Text>
                  </View>
                )}

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>CAMPOS PERSONALIZADOS (STUDIO)</Text>
                  {isEditing ? (
                    <View>
                      <Text style={styles.label}>Razón Social</Text>
                      <TextInput style={styles.input} value={editRazonSocial} onChangeText={setEditRazonSocial} />
                      <Text style={styles.label}>Complemento</Text>
                      <TextInput style={styles.input} value={editComplemento} onChangeText={setEditComplemento} />
                      <Text style={styles.label}>Giro</Text>
                      <TextInput style={styles.input} value={editGiro} onChangeText={setEditGiro} />
                      <Text style={styles.label}>Tipo de Documento</Text>
                      <TextInput style={styles.input} value={editTipoDocumento} onChangeText={setEditTipoDocumento} />
                      <Text style={styles.label}>Pago a Proveedor</Text>
                      <TextInput style={styles.input} value={editPagoProveedor} onChangeText={setEditPagoProveedor} />
                      <Text style={styles.label}>Pago de Cliente</Text>
                      <TextInput style={styles.input} value={editPagoCliente} onChangeText={setEditPagoCliente} />
                      <Text style={styles.label}>Ubicación (Lat: {currentLat?.toFixed(4) || 'N/D'}, Lng: {currentLng?.toFixed(4) || 'N/D'})</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15 }}>
                        <TouchableOpacity style={[styles.locationBtn, { flex: 1, backgroundColor: '#00A09D' }]} onPress={handleGetLocation}>
                          <FontAwesome name="location-arrow" size={14} color="#fff" />
                          <Text style={styles.locationBtnText}> MI POSICIÓN</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.locationBtn, { flex: 1, backgroundColor: '#714B67' }]} onPress={() => handleOpenMap('edit')}>
                          <FontAwesome name="map" size={14} color="#fff" />
                          <Text style={styles.locationBtnText}> BUSCAR EN MAPA</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View>
                      <DetailRow icon="briefcase" label="Razón Social" value={selectedPartner?.x_studio_razon_social} />
                      <DetailRow icon="plus-square" label="Complemento" value={selectedPartner?.x_studio_complemento} />
                      <DetailRow icon="industry" label="Giro" value={selectedPartner?.x_studio_giro} />
                      <DetailRow icon="file-text-o" label="Tipo de Documento" value={selectedPartner?.x_studio_tipo_de_documento} />
                      <DetailRow icon="money" label="Pago a Proveedor" value={selectedPartner?.x_studio_pago_a_proveedor} />
                      <DetailRow icon="credit-card" label="Pago de Cliente" value={selectedPartner?.x_studio_pago_de_cliente} />
                      <Text style={[styles.sectionTitle, { marginTop: 15 }]}>UBICACIÓN</Text>
                      <DetailRow icon="globe" label="Latitud" value={selectedPartner?.partner_latitude?.toString()} />
                      <DetailRow icon="globe" label="Longitud" value={selectedPartner?.partner_longitude?.toString()} />
                      {(selectedPartner?.partner_latitude != null && selectedPartner?.partner_longitude != null) && (
                        <TouchableOpacity style={[styles.locationBtn, { marginTop: 10 }]} onPress={() => handleOpenMap('view')}>
                          <FontAwesome name="map-marker" size={14} color="#fff" />
                          <Text style={styles.locationBtnText}> VER EN MAPA</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>

                {isEditing && (
                  <TouchableOpacity style={styles.saveBtn} onPress={handleUpdatePartner} disabled={loading}>
                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>GUARDAR CAMBIOS</Text>}
                  </TouchableOpacity>
                )}

                <View style={{ height: 40 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* MODAL SELECCION EN MAPA */}
      <Modal visible={mapModalVisible} animationType="slide">
        <View style={{ flex: 1 }}>
          <View style={[styles.modalHeader, { paddingHorizontal: 20, paddingTop: 50, backgroundColor: '#fff', marginBottom: 0 }]}>
            <Text style={styles.modalTitle}>
              {mapMode === 'view' ? 'Ubicación del Cliente' : 'Seleccionar Ubicación'}
            </Text>
            <TouchableOpacity onPress={() => setMapModalVisible(false)}>
              <FontAwesome name="times" size={24} color="#6B7280" />
            </TouchableOpacity>
          </View>
          
          {mapMode !== 'view' && (
            <View style={{ padding: 10, paddingHorizontal: 20, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 10, elevation: 3 }}>
              <TextInput 
                style={[styles.input, { flex: 1, marginBottom: 0, height: 45, backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' }]} 
                placeholder="Buscar por dirección..."
                value={searchAddress}
                onChangeText={setSearchAddress}
                onSubmitEditing={handleSearchLocation}
              />
              <TouchableOpacity style={{ backgroundColor: '#714B67', padding: 12, borderRadius: 8, height: 45, justifyContent: 'center', alignItems: 'center' }} onPress={handleSearchLocation}>
                {loading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="search" size={16} color="#fff" />}
              </TouchableOpacity>
              <TouchableOpacity style={{ backgroundColor: '#00A09D', padding: 12, borderRadius: 8, height: 45, justifyContent: 'center', alignItems: 'center' }} onPress={handleCenterOnMeMap}>
                {loading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="crosshairs" size={18} color="#fff" />}
              </TouchableOpacity>
            </View>
          )}

          <MapView
            style={styles.mapStyles}
            showsUserLocation={true}
            showsMyLocationButton={false}
            region={mapRegion}
            onRegionChangeComplete={(region) => setMapRegion(region)}
            onPress={(e) => {
              if (mapMode !== 'view') {
                setTempLat(e.nativeEvent.coordinate.latitude);
                setTempLng(e.nativeEvent.coordinate.longitude);
              }
            }}
          >
            {(tempLat != null && tempLng != null) && (
              <Marker
                coordinate={{ latitude: tempLat, longitude: tempLng }}
                title="Ubicación Seleccionada"
                draggable={mapMode !== 'view'}
                onDragEnd={(e) => {
                  setTempLat(e.nativeEvent.coordinate.latitude);
                  setTempLng(e.nativeEvent.coordinate.longitude);
                }}
              />
            )}
          </MapView>

          {mapMode !== 'view' && (
            <TouchableOpacity style={styles.confirmMapBtn} onPress={handleConfirmMapLocation}>
              <Text style={styles.saveBtnText}>CONFIRMAR UBICACIÓN</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: any, label: string, value: any }) {
  if (!value || value === 'false') return null;
  return (
    <View style={styles.detailRow}>
      <View style={styles.iconCircle}>
        <FontAwesome name={icon} size={14} color="#00A09D" />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

function FinanceItem({ label, value, color }: { label: string, value: any, color: string }) {
  return (
    <View style={styles.financeItem}>
      <Text style={styles.financeLabel}>{label}</Text>
      <Text style={[styles.financeValue, { color }]}>
        Bs. {Number(value || 0).toFixed(2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    elevation: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#714B67',
  },
  newButton: {
    backgroundColor: '#00A09D',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 8,
  },
  newButtonText: {
    marginLeft: 5,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 15,
    marginBottom: 0,
    paddingHorizontal: 15,
    borderRadius: 12,
    height: 48,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
  card: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  avatar: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: '#E6F6F5',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden'
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover'
  },
  avatarText: {
    color: '#00A09D',
    fontWeight: 'bold',
    fontSize: 18,
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  infoText: {
    fontSize: 13,
    color: '#6B7280',
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#F3F4F6',
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    paddingHorizontal: 20,
    paddingTop: 20,
    height: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB'
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#714B67',
  },
  modalBody: {
    flex: 1
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 5
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 15
  },
  saveBtn: {
    backgroundColor: '#00A09D',
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  // DETAIL STYLES
  detailHeader: {
    alignItems: 'center',
    marginVertical: 20
  },
  largeAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#fff'
  },
  largeAvatarImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover'
  },
  largeAvatarText: {
    fontSize: 40,
    color: '#00A09D',
    fontWeight: 'bold'
  },
  detailName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 10,
    textAlign: 'center'
  },
  detailSub: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center'
  },
  section: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 15,
    marginBottom: 15,
    elevation: 1
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#9CA3AF',
    marginBottom: 12,
    letterSpacing: 1
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E6F6F5',
    justifyContent: 'center',
    alignItems: 'center'
  },
  detailLabel: {
    fontSize: 11,
    color: '#9CA3AF'
  },
  detailValue: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '500'
  },
  financeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10
  },
  financeItem: {
    width: '47%',
    padding: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6'
  },
  financeLabel: {
    fontSize: 10,
    color: '#6B7280',
    marginBottom: 4
  },
  financeValue: {
    fontSize: 14,
    fontWeight: 'bold'
  },
  commentText: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
    fontStyle: 'italic'
  },
  // LOCATION STYLES
  locationBtn: {
    backgroundColor: '#00A09D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
  },
  locationBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  mapStyles: {
    flex: 1,
    width: '100%',
  },
  confirmMapBtn: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: '#00A09D',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 5,
  }
});
