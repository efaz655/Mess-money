import React, { useState, useEffect, useCallback } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';

const SUPABASE_URL = 'https://mfehmbtbnejzwvavwlsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_x0CUThwvsAYvk9DQ3WkgrA_09YEtf8W';

const sbHeaders = {
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function sbFetch(path, options = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: { ...sbHeaders, ...(options.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }
  if (!res.ok) {
    throw new Error((data && data.message) || 'Error ' + res.status);
  }
  return data;
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function computeCutOff(balancesObj) {
  const debtors = [];
  const creditors = [];
  Object.entries(balancesObj).forEach(([person, bal]) => {
    if (bal < -0.5) debtors.push({ person, amount: Math.abs(bal) });
    else if (bal > 0.5) creditors.push({ person, amount: bal });
  });
  const settlements = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    settlements.push({
      from: debtors[i].person,
      to: creditors[j].person,
      amount: Math.round(pay),
    });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount < 0.5) i++;
    if (creditors[j].amount < 0.5) j++;
  }
  return settlements;
}

export default function App() {
  const [myName, setMyName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomNameInput, setRoomNameInput] = useState('');
  const [roomMode, setRoomMode] = useState('join');
  const [authError, setAuthError] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [activeRoom, setActiveRoom] = useState(null);

  const [activeTab, setActiveTab] = useState('personal');

  const [members, setMembers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupExpenses, setGroupExpenses] = useState([]);
  const [syncing, setSyncing] = useState(false);

  const [selectedFriend, setSelectedFriend] = useState('');
  const [txType, setTxType] = useState('took');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [grpPaidBy, setGrpPaidBy] = useState('');
  const [grpAmount, setGrpAmount] = useState('');
  const [grpNote, setGrpNote] = useState('');
  const [grpSplitAmong, setGrpSplitAmong] = useState([]);
  const [grpError, setGrpError] = useState('');

  const loadRoomData = useCallback(async (code) => {
    if (!code) return;
    try {
      setSyncing(true);
      const enc = encodeURIComponent(code);
      const [mData, tData, gData, geData] = await Promise.all([
        sbFetch('members?room_code=eq.' + enc + '&order=joined_at.asc'),
        sbFetch('transactions?room_code=eq.' + enc + '&order=created_at.desc'),
        sbFetch('expense_groups?room_code=eq.' + enc + '&order=created_at.desc'),
        sbFetch('group_expenses?room_code=eq.' + enc + '&order=created_at.desc'),
      ]);
      setMembers(mData || []);
      setTransactions(tData || []);
      setGroups(gData || []);
      setGroupExpenses(geData || []);
    } catch (err) {
      // Ignore transient poll errors
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!activeRoom) return;
    loadRoomData(activeRoom.code);
    const timer = setInterval(() => {
      loadRoomData(activeRoom.code);
    }, 3000);
    return () => clearInterval(timer);
  }, [activeRoom, loadRoomData]);

  useEffect(() => {
    const others = members.map((m) => m.name).filter((n) => n !== myName);
    if (others.length > 0 && !others.includes(selectedFriend)) {
      setSelectedFriend(others[0]);
    }
    if (members.length > 0 && !grpPaidBy) {
      setGrpPaidBy(myName);
    }
    if (members.length > 0 && grpSplitAmong.length === 0) {
      setGrpSplitAmong(members.map((m) => m.name));
    }
  }, [members, myName, selectedFriend, grpPaidBy, grpSplitAmong.length]);

  const handleEnterRoom = async () => {
    const cleanName = myName.trim();
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanName) {
      setAuthError('তোমার নাম লেখো।');
      return;
    }
    if (!cleanCode) {
      setAuthError('রুম কোড লেখো।');
      return;
    }

    setAuthError('');
    setLoadingAuth(true);
    try {
      const existing = await sbFetch(
        'rooms?code=eq.' + encodeURIComponent(cleanCode)
      );

      if (roomMode === 'create') {
        if (existing && existing.length > 0) {
          setAuthError('এই কোডের রুম আগেই আছে! অন্য কোড দাও বা Join করো।');
          setLoadingAuth(false);
          return;
        }
        const rName = roomNameInput.trim() || 'Room ' + cleanCode;
        const created = await sbFetch('rooms', {
          method: 'POST',
          body: JSON.stringify({
            code: cleanCode,
            name: rName,
            created_by: cleanName,
          }),
        });
        await sbFetch('members', {
          method: 'POST',
          body: JSON.stringify({ room_code: cleanCode, name: cleanName }),
        });
        setActiveRoom(created[0]);
      } else {
        if (!existing || existing.length === 0) {
          setAuthError('এই কোডের কোনো রুম পাওয়া যায়নি।');
          setLoadingAuth(false);
          return;
        }
        const existingMember = await sbFetch(
          'members?room_code=eq.' +
            encodeURIComponent(cleanCode) +
            '&name=eq.' +
            encodeURIComponent(cleanName)
        );
        if (!existingMember || existingMember.length === 0) {
          await sbFetch('members', {
            method: 'POST',
            body: JSON.stringify({ room_code: cleanCode, name: cleanName }),
          });
        }
        setActiveRoom(existing[0]);
      }
    } catch (err) {
      setAuthError('সমস্যা হয়েছে: ' + err.message);
    } finally {
      setLoadingAuth(false);
    }
  };

  const handleAddTransaction = async () => {
    const num = parseFloat(amount);
    if (!selectedFriend) {
      setFormError('আগে অন্য একজন বন্ধুকে এই রুমে জয়েন করতে বলো।');
      return;
    }
    if (!num || num <= 0) {
      setFormError('সঠিক টাকার পরিমাণ লেখো।');
      return;
    }
    setFormError('');
    try {
      await sbFetch('transactions', {
        method: 'POST',
        body: JSON.stringify({
          room_code: activeRoom.code,
          from_user: txType === 'took' ? myName.trim() : selectedFriend,
          to_user: txType === 'took' ? selectedFriend : myName.trim(),
          amount: num,
          note: note.trim() || 'কোনো নোট নেই',
          created_by: myName.trim(),
          confirm_target: selectedFriend,
          status: 'pending',
          reject_seen: false,
        }),
      });
      setAmount('');
      setNote('');
      loadRoomData(activeRoom.code);
    } catch (err) {
      setFormError(err.message);
    }
  };

  const handleUpdateTxStatus = async (id, status) => {
    try {
      await sbFetch('transactions?id=eq.' + id, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      loadRoomData(activeRoom.code);
    } catch (err) {}
  };

  const handleDismissReject = async (id) => {
    try {
      await sbFetch('transactions?id=eq.' + id, {
        method: 'PATCH',
        body: JSON.stringify({ reject_seen: true }),
      });
      loadRoomData(activeRoom.code);
    } catch (err) {}
  };

  const handleCreateGroup = async () => {
    const gName = newGroupName.trim();
    if (!gName) return;
    try {
      const created = await sbFetch('expense_groups', {
        method: 'POST',
        body: JSON.stringify({
          room_code: activeRoom.code,
          name: gName,
          created_by: myName.trim(),
        }),
      });
      setNewGroupName('');
      if (created && created[0]) setSelectedGroupId(created[0].id);
      loadRoomData(activeRoom.code);
    } catch (err) {}
  };

  const handleAddGroupExpense = async () => {
    const num = parseFloat(grpAmount);
    if (!num || num <= 0) {
      setGrpError('সঠিক টাকার পরিমাণ দাও।');
      return;
    }
    if (grpSplitAmong.length === 0) {
      setGrpError('কমপক্ষে ১ জনকে সিলেক্ট করো।');
      return;
    }
    setGrpError('');
    try {
      await sbFetch('group_expenses', {
        method: 'POST',
        body: JSON.stringify({
          group_id: selectedGroupId,
          room_code: activeRoom.code,
          paid_by: grpPaidBy || myName.trim(),
          amount: num,
          note: grpNote.trim() || 'গ্রুপ খরচ',
          split_among: grpSplitAmong,
        }),
      });
      setGrpAmount('');
      setGrpNote('');
      loadRoomData(activeRoom.code);
    } catch (err) {
      setGrpError(err.message);
    }
  };

  const toggleSplitMember = (name) => {
    if (grpSplitAmong.includes(name)) {
      setGrpSplitAmong(grpSplitAmong.filter((n) => n !== name));
    } else {
      setGrpSplitAmong([...grpSplitAmong, name]);
    }
  };

  if (!activeRoom) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#09090b" />
        <ScrollView contentContainerStyle={styles.joinWrapper}>
          <Text style={styles.title}>Mess Money</Text>
          <Text style={styles.subtitle}>
            রুম বানাও বা বন্ধুদের রুম কোড দিয়ে জয়েন করো
          </Text>

          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, roomMode === 'join' && styles.toggleActiveGreen]}
              onPress={() => {
                setRoomMode('join');
                setAuthError('');
              }}
            >
              <Text style={styles.toggleText}>Join Room</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, roomMode === 'create' && styles.toggleActiveGreen]}
              onPress={() => {
                setRoomMode('create');
                setAuthError('');
              }}
            >
              <Text style={styles.toggleText}>Create Room</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>তোমার প্রোফাইল নাম</Text>
            <TextInput
              style={styles.input}
              value={myName}
              onChangeText={setMyName}
              placeholder="যেমন: Yeakin"
              placeholderTextColor="#71717a"
            />

            {roomMode === 'create' && (
              <>
                <Text style={styles.label}>রুমের নাম</Text>
                <TextInput
                  style={styles.input}
                  value={roomNameInput}
                  onChangeText={setRoomNameInput}
                  placeholder="যেমন: মেস ৬ বন্ধু"
                  placeholderTextColor="#71717a"
                />
              </>
            )}

            <Text style={styles.label}>রুম কোড (সবাই এই কোড দিয়ে ঢুকবে)</Text>
            <TextInput
              style={styles.input}
              value={roomCode}
              onChangeText={setRoomCode}
              placeholder="যেমন: MESS24"
              placeholderTextColor="#71717a"
              autoCapitalize="characters"
            />

            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleEnterRoom}
              disabled={loadingAuth}
            >
              {loadingAuth ? (
                <ActivityIndicator color="#052e16" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {roomMode === 'create' ? 'নতুন রুম বানাও →' : 'রুমে প্রবেশ করো →'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const cleanMe = myName.trim();
  const otherMembers = members.map((m) => m.name).filter((n) => n !== cleanMe);

  const needMyConfirm = transactions.filter(
    (t) => t.status === 'pending' && t.confirm_target === cleanMe
  );
  const waitingOthers = transactions.filter(
    (t) => t.status === 'pending' && t.created_by === cleanMe
  );
  const myRejectAlerts = transactions.filter(
    (t) => t.status === 'rejected' && t.created_by === cleanMe && !t.reject_seen
  );
  const confirmedTx = transactions.filter((t) => t.status === 'confirmed');

  const netBalances = {};
  members.forEach((m) => {
    netBalances[m.name] = 0;
  });
  confirmedTx.forEach((t) => {
    netBalances[t.from_user] = (netBalances[t.from_user] || 0) - Number(t.amount);
    netBalances[t.to_user] = (netBalances[t.to_user] || 0) + Number(t.amount);
  });

  const settlements = computeCutOff(netBalances);
  const myNet = Math.round(netBalances[cleanMe] || 0);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#09090b" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>
              {activeRoom.name} ({activeRoom.code})
            </Text>
            <Text style={styles.headerSub}>
              প্রোফাইল: {cleanMe} • {members.length} জন মেম্বার{' '}
              {syncing ? '• সিঙ্ক হচ্ছে...' : '• লাইভ'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.exitBtn}
            onPress={() => {
              setActiveRoom(null);
              setSelectedGroupId(null);
            }}
          >
            <Text style={styles.exitBtnText}>বের হও</Text>
          </TouchableOpacity>
        </View>

        {myRejectAlerts.map((tx) => (
          <View key={tx.id} style={styles.rejectBanner}>
            <Text style={styles.rejectBannerText}>
              ❌ {tx.confirm_target} তোমার ৳{tx.amount} ({tx.note}) রিকোয়েস্ট Reject করেছে!
            </Text>
            <TouchableOpacity onPress={() => handleDismissReject(tx.id)}>
              <Text style={styles.dismissText}>বুঝেছি</Text>
            </TouchableOpacity>
          </View>
        ))}

        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'personal' && styles.tabBtnActive]}
            onPress={() => setActiveTab('personal')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'personal' && styles.tabTextActive,
              ]}
            >
              পার্সোনাল (1-on-1)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'groups' && styles.tabBtnActive]}
            onPress={() => setActiveTab('groups')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'groups' && styles.tabTextActive,
              ]}
            >
              গ্রুপ খরচ (আলাদা জগত)
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'personal' ? (
          <>
            <View style={styles.profileBox}>
              <Text style={styles.profileLabel}>আমার মোট স্ট্যাটাস</Text>
              <Text
                style={[
                  styles.profileAmount,
                  myNet > 0
                    ? { color: '#34d399' }
                    : myNet < 0
                    ? { color: '#fb7185' }
                    : { color: '#e4e4e7' },
                ]}
              >
                {myNet > 0
                  ? '+৳' + myNet + ' পাবে'
                  : myNet < 0
                  ? '−৳' + Math.abs(myNet) + ' দেবে'
                  : '৳0 (সমান সমান)'}
              </Text>
            </View>

            {needMyConfirm.length > 0 && (
              <View style={[styles.card, { borderColor: '#f59e0b' }]}>
                <Text style={[styles.cardTitle, { color: '#fbbf24' }]}>
                  তোমার কনফার্মেশন দরকার ({needMyConfirm.length})
                </Text>
                {needMyConfirm.map((tx) => (
                  <View key={tx.id} style={styles.txRow}>
                    <Text style={styles.txMain}>
                      {tx.from_user} → {tx.to_user}-কে ৳{tx.amount} দেবে
                    </Text>
                    <Text style={styles.txMeta}>
                      📝 {tx.note} • 🕒 {formatDateTime(tx.created_at)}
                    </Text>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.confirmBtn}
                        onPress={() => handleUpdateTxStatus(tx.id, 'confirmed')}
                      >
                        <Text style={styles.actionText}>✓ Confirm</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.rejectBtn}
                        onPress={() => handleUpdateTxStatus(tx.id, 'rejected')}
                      >
                        <Text style={styles.actionText}>✕ Reject</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>নতুন লেনদেন যোগ করো</Text>
              {otherMembers.length === 0 ? (
                <Text style={styles.emptyText}>
                  এখনো অন্য কেউ রুমে জয়েন করেনি। কোড "{activeRoom.code}" বন্ধুদের দাও!
                </Text>
              ) : (
                <>
                  <View style={styles.toggleRow}>
                    <TouchableOpacity
                      style={[
                        styles.toggleBtn,
                        txType === 'took' && styles.toggleActiveRose,
                      ]}
                      onPress={() => setTxType('took')}
                    >
                      <Text style={styles.toggleText}>আমি টাকা নিয়েছি</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.toggleBtn,
                        txType === 'gave' && styles.toggleActiveGreen,
                      ]}
                      onPress={() => setTxType('gave')}
                    >
                      <Text style={styles.toggleText}>আমি টাকা দিয়েছি</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.label}>কোন বন্ধুর সাথে?</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {otherMembers.map((friend) => (
                      <TouchableOpacity
                        key={friend}
                        style={[
                          styles.chip,
                          selectedFriend === friend && styles.chipActive,
                        ]}
                        onPress={() => setSelectedFriend(friend)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            selectedFriend === friend && styles.chipTextActive,
                          ]}
                        >
                          {friend}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={styles.label}>টাকার পরিমাণ (৳)</Text>
                  <TextInput
                    style={styles.input}
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="numeric"
                    placeholder="যেমন: 500"
                    placeholderTextColor="#71717a"
                  />

                  <Text style={styles.label}>নোট (ঐচ্ছিক)</Text>
                  <TextInput
                    style={styles.input}
                    value={note}
                    onChangeText={setNote}
                    placeholder="যেমন: চা-নাস্তা / রিকশা"
                    placeholderTextColor="#71717a"
                  />

                  {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleAddTransaction}
                  >
                    <Text style={styles.primaryBtnText}>
                      {selectedFriend}-এর কাছে কনফার্মেশন পাঠাও
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {waitingOthers.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  বন্ধুর কনফার্মেশনের অপেক্ষায় ({waitingOthers.length})
                </Text>
                {waitingOthers.map((tx) => (
                  <View key={tx.id} style={styles.txRow}>
                    <Text style={styles.txMain}>
                      {tx.from_user} → {tx.to_user}: ৳{tx.amount} (Pending)
                    </Text>
                    <Text style={styles.txMeta}>
                      📝 {tx.note} • 🕒 {formatDateTime(tx.created_at)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.header}>
                <Text style={styles.cardTitle}>ফাইনাল হিসাব (Cut-off)</Text>
                <TouchableOpacity onPress={() => setShowDetails(!showDetails)}>
                  <Text style={styles.linkText}>
                    {showDetails ? 'Details লুকাও' : 'কীভাবে হলো? (Details)'}
                  </Text>
                </TouchableOpacity>
              </View>

              {settlements.length === 0 ? (
                <Text style={styles.emptyText}>সব হিসাব ক্লিয়ার আছে!</Text>
              ) : (
                settlements.map((s, idx) => (
                  <View key={idx} style={styles.settleRow}>
                    <Text style={styles.settleText}>
                      <Text style={styles.bold}>{s.from}</Text> দেবে{' '}
                      <Text style={styles.bold}>{s.to}</Text>-কে
                    </Text>
                    <Text style={styles.settleAmount}>৳{s.amount}</Text>
                  </View>
                ))
              )}

              {showDetails && (
                <View style={styles.detailsBox}>
                  <Text style={styles.detailsHeading}>১. সবার নেট ব্যালেন্স:</Text>
                  {Object.entries(netBalances).map(([person, bal]) => (
                    <Text key={person} style={styles.detailsLine}>
                      • {person}:{' '}
                      {bal > 0
                        ? '+৳' + Math.round(bal) + ' (পাবে)'
                        : bal < 0
                        ? '−৳' + Math.round(Math.abs(bal)) + ' (দেবে)'
                        : '৳0 (ক্লিয়ার)'}
                    </Text>
                  ))}

                  <Text style={[styles.detailsHeading, { marginTop: 10 }]}>
                    ২. কনফার্মড লেনদেন হিস্ট্রি ({confirmedTx.length}):
                  </Text>
                  {confirmedTx.length === 0 ? (
                    <Text style={styles.detailsLine}>কোনো কনফার্মড লেনদেন নেই।</Text>
                  ) : (
                    confirmedTx.map((tx) => (
                      <Text key={tx.id} style={styles.detailsLine}>
                        • {tx.from_user} → {tx.to_user}: ৳{tx.amount} ({tx.note} •{' '}
                        {formatDateTime(tx.created_at)})
                      </Text>
                    ))
                  )}
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>নতুন গ্রুপ / ইভেন্ট খোলো</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                  placeholder="যেমন: মেস বাজার / ট্যুর"
                  placeholderTextColor="#71717a"
                />
                <TouchableOpacity
                  style={styles.smallAddBtn}
                  onPress={handleCreateGroup}
                >
                  <Text style={styles.primaryBtnText}>+ বানাও</Text>
                </TouchableOpacity>
              </View>

              {groups.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 12 }}
                >
                  {groups.map((g) => (
                    <TouchableOpacity
                      key={g.id}
                      style={[
                        styles.chip,
                        selectedGroupId === g.id && styles.chipActive,
                      ]}
                      onPress={() => setSelectedGroupId(g.id)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selectedGroupId === g.id && styles.chipTextActive,
                        ]}
                      >
                        {g.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>

            {selectedGroupId ? (
              (() => {
                const currentGrp = groups.find((g) => g.id === selectedGroupId);
                const exps = groupExpenses.filter(
                  (e) => e.group_id === selectedGroupId
                );
                const grpBalances = {};
                members.forEach((m) => {
                  grpBalances[m.name] = 0;
                });
                let grpTotal = 0;
                exps.forEach((e) => {
                  const amt = Number(e.amount);
                  grpTotal += amt;
                  grpBalances[e.paid_by] = (grpBalances[e.paid_by] || 0) + amt;
                  const list = Array.isArray(e.split_among) ? e.split_among : [];
                  if (list.length > 0) {
                    const share = amt / list.length;
                    list.forEach((p) => {
                      grpBalances[p] = (grpBalances[p] || 0) - share;
                    });
                  }
                });
                const grpSettlements = computeCutOff(grpBalances);

                return (
                  <>
                    <View style={styles.card}>
                      <Text style={styles.cardTitle}>
                        {currentGrp ? currentGrp.name : ''} — খরচ যোগ করো
                      </Text>

                      <Text style={styles.label}>কে টাকা দিয়েছে?</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {members.map((m) => (
                          <TouchableOpacity
                            key={m.name}
                            style={[
                              styles.chip,
                              grpPaidBy === m.name && styles.chipActive,
                            ]}
                            onPress={() => setGrpPaidBy(m.name)}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                grpPaidBy === m.name && styles.chipTextActive,
                              ]}
                            >
                              {m.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>

                      <Text style={styles.label}>টাকার পরিমাণ (৳)</Text>
                      <TextInput
                        style={styles.input}
                        value={grpAmount}
                        onChangeText={setGrpAmount}
                        keyboardType="numeric"
                        placeholder="যেমন: 1200"
                        placeholderTextColor="#71717a"
                      />

                      <Text style={styles.label}>নোট</Text>
                      <TextInput
                        style={styles.input}
                        value={grpNote}
                        onChangeText={setGrpNote}
                        placeholder="যেমন: রাতের বাজার"
                        placeholderTextColor="#71717a"
                      />

                      <Text style={styles.label}>কাদের মধ্যে ভাগ হবে?</Text>
                      <View style={styles.wrapRow}>
                        {members.map((m) => {
                          const on = grpSplitAmong.includes(m.name);
                          return (
                            <TouchableOpacity
                              key={m.name}
                              style={[styles.chip, on && styles.chipActive]}
                              onPress={() => toggleSplitMember(m.name)}
                            >
                              <Text
                                style={[
                                  styles.chipText,
                                  on && styles.chipTextActive,
                                ]}
                              >
                                {on ? '✓ ' + m.name : m.name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {grpError ? (
                        <Text style={styles.errorText}>{grpError}</Text>
                      ) : null}

                      <TouchableOpacity
                        style={styles.primaryBtn}
                        onPress={handleAddGroupExpense}
                      >
                        <Text style={styles.primaryBtnText}>গ্রুপ খরচ সেভ করো</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.card}>
                      <Text style={styles.cardTitle}>
                        {currentGrp ? currentGrp.name : ''} হিসাব (মোট ৳{Math.round(grpTotal)})
                      </Text>
                      {grpSettlements.length === 0 ? (
                        <Text style={styles.emptyText}>সব হিসাব সমান আছে।</Text>
                      ) : (
                        grpSettlements.map((s, idx) => (
                          <View key={idx} style={styles.settleRow}>
                            <Text style={styles.settleText}>
                              <Text style={styles.bold}>{s.from}</Text> দেবে{' '}
                              <Text style={styles.bold}>{s.to}</Text>-কে
                            </Text>
                            <Text style={styles.settleAmount}>৳{s.amount}</Text>
                          </View>
                        ))
                      )}

                      <Text style={[styles.detailsHeading, { marginTop: 14 }]}>
                        খরচের তালিকা:
                      </Text>
                      {exps.map((e) => (
                        <View key={e.id} style={styles.txRow}>
                          <Text style={styles.txMain}>
                            {e.note} — ৳{e.amount} (দিয়েছে: {e.paid_by})
                          </Text>
                          <Text style={styles.txMeta}>
                            ভাগ: {Array.isArray(e.split_among) ? e.split_among.join(', ') : ''} •{' '}
                            {formatDateTime(e.created_at)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                );
              })()
            ) : (
              <View style={styles.card}>
                <Text style={styles.emptyText}>
                  ওপরে থেকে একটা গ্রুপ সিলেক্ট করো অথবা নতুন বানাও!
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  joinWrapper: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 14 },
  title: { color: '#ffffff', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#a1a1aa', fontSize: 14, marginTop: 4, marginBottom: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  headerSub: { color: '#a1a1aa', fontSize: 12, marginTop: 2 },
  exitBtn: {
    backgroundColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  exitBtnText: { color: '#e4e4e7', fontSize: 12, fontWeight: '600' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#10b981' },
  tabText: { color: '#a1a1aa', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#052e16', fontWeight: '700' },
  profileBox: {
    backgroundColor: '#18181b',
    borderColor: '#27272a',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  profileLabel: { color: '#a1a1aa', fontSize: 13, fontWeight: '600' },
  profileAmount: { fontSize: 18, fontWeight: '700' },
  card: {
    backgroundColor: '#18181b',
    borderColor: '#27272a',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  cardTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  label: { color: '#a1a1aa', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: '#09090b',
    borderColor: '#3f3f46',
    borderWidth: 1,
    borderRadius: 10,
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  primaryBtn: {
    backgroundColor: '#10b981',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  smallAddBtn: {
    backgroundColor: '#10b981',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#052e16', fontSize: 14, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  toggleBtn: {
    flex: 1,
    backgroundColor: '#27272a',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleActiveRose: { backgroundColor: '#be123c' },
  toggleActiveGreen: { backgroundColor: '#047857' },
  toggleText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  chip: {
    backgroundColor: '#27272a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 6,
  },
  chipActive: { backgroundColor: '#10b981' },
  chipText: { color: '#d4d4d8', fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#052e16', fontWeight: '700' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap' },
  errorText: { color: '#fb7185', fontSize: 12, marginTop: 8 },
  rejectBanner: {
    backgroundColor: '#4c0519',
    borderColor: '#be123c',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rejectBannerText: { color: '#fda4af', fontSize: 12, flex: 1 },
  dismissText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  txRow: {
    backgroundColor: '#09090b',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 6,
  },
  txMain: { color: '#f4f4f5', fontSize: 13, fontWeight: '600' },
  txMeta: { color: '#a1a1aa', fontSize: 11 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  confirmBtn: {
    flex: 1,
    backgroundColor: '#059669',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: '#e11d48',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  linkText: { color: '#34d399', fontSize: 12, fontWeight: '600' },
  settleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#09090b',
    padding: 12,
    borderRadius: 10,
    marginTop: 6,
  },
  settleText: { color: '#e4e4e7', fontSize: 14 },
  bold: { fontWeight: '700', color: '#ffffff' },
  settleAmount: { color: '#34d399', fontSize: 15, fontWeight: '700' },
  emptyText: { color: '#71717a', fontSize: 13, textAlign: 'center', paddingVertical: 10 },
  detailsBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  detailsHeading: { color: '#d4d4d8', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  detailsLine: { color: '#a1a1aa', fontSize: 12, marginBottom: 4 },
});
